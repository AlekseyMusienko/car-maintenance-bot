require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const cron = require('node-cron');
const mongoose = require('mongoose');
const express = require('express');
const moment = require('moment');

console.log('Запуск бота...');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'Установлен' : 'Не установлен');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Установлен' : 'Не установлен');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

// Настройка Express для обработки JSON и вебхуков
app.use(express.json());
app.use(bot.webhookCallback('/api/bot'));

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB подключен'))
  .catch(err => console.error('Ошибка MongoDB:', err));

// Схема пользователя
const UserSchema = new mongoose.Schema({
  user_id: { type: Number, required: true, unique: true },
  oil_changes: [{ date: String, mileage: Number, oil_name: String }],
  oil_adds: [{ date: String, mileage: Number, amount: Number }],
  repairs: [{
    date: String,
    category: String,
    parts: [{ name: String, cost: Number }],
    mileage: Number,
    repair_cost: Number,
    comment: String,
    photo_id: String
  }],
  last_mileage: { type: { date: String, mileage: Number }, default: null },
  last_request: { type: Date, default: null },
});
const User = mongoose.model('User', UserSchema);

// Подключаем сессии
bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

// Главное меню
const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('Замена масла', 'replace_oil')],
  [Markup.button.callback('Долив масла', 'add_oil')],
  [Markup.button.callback('Фиксация ремонта', 'add_repair')],
  [Markup.button.callback('Ввести текущий пробег', 'enter_mileage')],
  [Markup.button.callback('История (полная)', 'full_history')],
  [Markup.button.callback('История (с последней замены)', 'last_history')],
  [Markup.button.callback('История ремонтов', 'repair_history')],
  [Markup.button.callback('Экспорт данных', 'export_data')],
]);

// Категории ремонта
const repairCategories = [
  'Двигатель', 'Подвеска', 'Тормоза', 'Электрика', 'Кузов', 'Другое'
];
const repairCategoryKeyboard = Markup.inlineKeyboard(
  repairCategories.map(category => [Markup.button.callback(category, `category_${category}`)])
);

// Старт бота
bot.start((ctx) => {
  console.log('Получена команда /start от:', ctx.from.id);
  ctx.reply('Добро пожаловать! Выберите действие:', mainMenu);
});

// Обработка "Замена масла"
bot.action('replace_oil', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await User.findOne({ user_id: userId });
    if (!user) user = new User({ user_id: userId, oil_changes: [], oil_adds: [], repairs: [] });
    ctx.reply('Введите дату замены (например, 17.03.2025):');
    ctx.session.step = 'replace_date';
    ctx.session.user = user;
  } catch (err) {
    console.error('Ошибка в replace_oil:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка "Долив масла"
bot.action('add_oil', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await User.findOne({ user_id: userId });
    if (!user) user = new User({ user_id: userId, oil_changes: [], oil_adds: [], repairs: [] });
    ctx.reply('Введите дату долива (например, 17.03.2025):');
    ctx.session.step = 'add_date';
    ctx.session.user = user;
  } catch (err) {
    console.error('Ошибка в add_oil:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка "Фиксация ремонта"
bot.action('add_repair', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await User.findOne({ user_id: userId });
    if (!user) user = new User({ user_id: userId, oil_changes: [], oil_adds: [], repairs: [] });
    ctx.reply('Выберите категорию ремонта:', repairCategoryKeyboard);
    ctx.session.step = 'repair_category';
    ctx.session.user = user;
    ctx.session.repair = { parts: [] };
  } catch (err) {
    console.error('Ошибка в add_repair:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка категорий ремонта
bot.action(/category_(.+)/, async (ctx) => {
  try {
    const category = ctx.match[1];
    if (!repairCategories.includes(category)) {
      ctx.reply('Неверная категория, выберите снова:', repairCategoryKeyboard);
      return;
    }
    ctx.session.repair.category = category;
    ctx.reply('Введите дату и время ремонта (например, 17.03.2025 14:00):');
    ctx.session.step = 'repair_date';
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в category:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка "Ввести текущий пробег"
bot.action('enter_mileage', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await User.findOne({ user_id: userId });
    if (!user) user = new User({ user_id: userId, oil_changes: [], oil_adds: [], repairs: [] });
    ctx.reply('Введите текущий пробег (в км):');
    ctx.session.step = 'enter_mileage';
    ctx.session.user = user;
  } catch (err) {
    console.error('Ошибка в enter_mileage:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка текстового ввода
bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id;
    if (!ctx.session.step || !ctx.session.user) return;

    let user = ctx.session.user;

    // Замена масла
    if (ctx.session.step === 'replace_date') {
      if (!moment(ctx.message.text, 'DD.MM.YYYY', true).isValid()) {
        ctx.reply('Неверный формат даты. Введите в формате DD.MM.YYYY (например, 17.03.2025):');
        return;
      }
      ctx.session.date = ctx.message.text;
      ctx.reply('Введите пробег на момент замены (в км):');
      ctx.session.step = 'replace_mileage';
    } else if (ctx.session.step === 'replace_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage) || mileage < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение пробега:');
        return;
      }
      ctx.session.mileage = mileage;
      ctx.reply('Введите название масла:');
      ctx.session.step = 'replace_oil_name';
    } else if (ctx.session.step === 'replace_oil_name') {
      const oilChange = { date: ctx.session.date, mileage: ctx.session.mileage, oil_name: ctx.message.text };
      user.oil_changes.push(oilChange);
      user.last_mileage = { date: ctx.session.date, mileage: ctx.session.mileage };
      await user.save();
      ctx.reply(`Данные сохранены:\nДата: ${oilChange.date}\nПробег: ${oilChange.mileage} км\nМасло: ${oilChange.oil_name}`, mainMenu);
      ctx.session.step = null;
    }

    // Долив масла
    else if (ctx.session.step === 'add_date') {
      if (!moment(ctx.message.text, 'DD.MM.YYYY', true).isValid()) {
        ctx.reply('Неверный формат даты. Введите в формате DD.MM.YYYY (например, 17.03.2025):');
        return;
      }
      ctx.session.date = ctx.message.text;
      ctx.reply('Введите пробег на момент долива (в км):');
      ctx.session.step = 'add_mileage';
    } else if (ctx.session.step === 'add_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage) || mileage < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение пробега:');
        return;
      }
      ctx.session.mileage = mileage;
      ctx.reply('Введите количество долитого масла (в литрах):');
      ctx.session.step = 'add_amount';
    } else if (ctx.session.step === 'add_amount') {
      const amount = Number(ctx.message.text);
      if (isNaN(amount) || amount < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение количества масла:');
        return;
      }
      const oilAdd = { date: ctx.session.date, mileage: ctx.session.mileage, amount };
      user.oil_adds.push(oilAdd);
      await user.save();
      ctx.reply(`Данные сохранены:\nДата: ${oilAdd.date}\nПробег: ${oilAdd.mileage} км\nКоличество: ${oilAdd.amount} л`, mainMenu);
      ctx.session.step = null;
    }

    // Ремонт
    else if (ctx.session.step === 'repair_date') {
      if (!moment(ctx.message.text, 'DD.MM.YYYY HH:mm', true).isValid()) {
        ctx.reply('Неверный формат. Введите в формате DD.MM.YYYY HH:mm (например, 17.03.2025 14:00):');
        return;
      }
      ctx.session.repair.date = ctx.message.text;
      ctx.reply('Введите пробег на момент ремонта (в км):');
      ctx.session.step = 'repair_mileage';
    } else if (ctx.session.step === 'repair_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage) || mileage < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение пробега:');
        return;
      }
      ctx.session.repair.mileage = mileage;
      ctx.reply('Введите название запчасти (или "-" для пропуска):');
      ctx.session.step = 'repair_part_name';
    } else if (ctx.session.step === 'repair_part_name') {
      if (ctx.message.text !== '-') {
        ctx.session.part = { name: ctx.message.text };
        ctx.reply('Введите стоимость запчасти (в рублях):');
        ctx.session.step = 'repair_part_cost';
      } else {
        ctx.reply('Введите стоимость ремонта (в рублях):');
        ctx.session.step = 'repair_cost';
      }
    } else if (ctx.session.step === 'repair_part_cost') {
      const cost = Number(ctx.message.text);
      if (isNaN(cost) || cost < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение стоимости:');
        return;
      }
      ctx.session.part.cost = cost;
      ctx.session.repair.parts.push(ctx.session.part);
      ctx.reply('Добавить еще запчасть?', Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'add_another_part')],
        [Markup.button.callback('Нет', 'no_more_parts')]
      ]));
      ctx.session.step = 'repair_add_part';
    } else if (ctx.session.step === 'repair_cost') {
      const repair_cost = Number(ctx.message.text);
      if (isNaN(repair_cost) || repair_cost < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение стоимости ремонта:');
        return;
      }
      ctx.session.repair.repair_cost = repair_cost;
      ctx.reply('Введите комментарий (или "-" для пропуска):');
      ctx.session.step = 'repair_comment';
    } else if (ctx.session.step === 'repair_comment') {
      ctx.session.repair.comment = ctx.message.text === '-' ? '' : ctx.message.text;
      ctx.reply('Прикрепите фото (или отправьте "-" для пропуска):');
      ctx.session.step = 'repair_photo';
    }

    // Ввод текущего пробега
    else if (ctx.session.step === 'enter_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage) || mileage < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение пробега:');
        return;
      }
      const lastChange = user.oil_changes[user.oil_changes.length - 1];
      user.last_mileage = { date: new Date().toLocaleDateString('ru-RU'), mileage };
      await user.save();
      ctx.reply(`Пробег обновлен: ${mileage} км`);
      if (lastChange && mileage - lastChange.mileage >= 7000) {
        ctx.reply('Пора заменить масло!');
      }
      ctx.reply('Проверьте уровень масла. Доливали ли вы масло?', Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'add_oil_after_check')],
        [Markup.button.callback('Нет', 'no_oil_added')]
      ]));
      ctx.session.step = null;
    }
  } catch (err) {
    console.error('Ошибка обработки текста:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка дополнительных запчастей
bot.action('add_another_part', async (ctx) => {
  try {
    ctx.reply('Введите название следующей запчасти:');
    ctx.session.step = 'repair_part_name';
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в add_another_part:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

bot.action('no_more_parts', async (ctx) => {
  try {
    ctx.reply('Введите стоимость ремонта (в рублях):');
    ctx.session.step = 'repair_cost';
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в no_more_parts:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка фото ремонта
bot.on('photo', async (ctx) => {
  try {
    if (ctx.session.step !== 'repair_photo') return;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    ctx.session.repair.photo_id = photo.file_id;
    const repair = ctx.session.repair;
    ctx.session.user.repairs.push(repair);
    await ctx.session.user.save();
    ctx.reply(`Ремонт сохранен:\nКатегория: ${repair.category}\nДата: ${repair.date}\nПробег: ${repair.mileage} км\nЗапчасти: ${repair.parts.length > 0 ? repair.parts.map(p => `${p.name} (${p.cost} руб)`).join(', ') : 'нет'}\nСтоимость ремонта: ${repair.repair_cost} руб\nКомментарий: ${repair.comment || 'нет'}`, mainMenu);
    ctx.session.step = null;
    ctx.session.repair = null;
  } catch (err) {
    console.error('Ошибка обработки фото:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Пропуск фото
bot.hears('-', async (ctx) => {
  try {
    if (ctx.session.step === 'repair_photo') {
      const repair = ctx.session.repair;
      ctx.session.user.repairs.push(repair);
      await ctx.session.user.save();
      ctx.reply(`Ремонт сохранен:\nКатегория: ${repair.category}\nДата: ${repair.date}\nПробег: ${repair.mileage} км\nЗапчасти: ${repair.parts.length > 0 ? repair.parts.map(p => `${p.name} (${p.cost} руб)`).join(', ') : 'нет'}\nСтоимость ремонта: ${repair.repair_cost} руб\nКомментарий: ${repair.comment || 'нет'}`, mainMenu);
      ctx.session.step = null;
      ctx.session.repair = null;
    }
  } catch (err) {
    console.error('Ошибка пропуска фото:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка ответа на вопрос о доливе
bot.action('add_oil_after_check', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await User.findOne({ user_id: userId });
    ctx.session.user = user;
    ctx.session.step = 'add_date';
    ctx.reply('Введите дату долива (например, 17.03.2025):');
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в add_oil_after_check:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

bot.action('no_oil_added', async (ctx) => {
  try {
    ctx.reply('Хорошо, уровень масла проверен.', mainMenu);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в no_oil_added:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Полная история
bot.action('full_history', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || (user.oil_changes.length === 0 && user.repairs.length === 0)) {
      ctx.reply('История пуста.', mainMenu);
      return;
    }

    // Масло
    let oilMessage = '';
    const changes = user.oil_changes.sort((a, b) => moment(a.date, 'DD.MM.YYYY').diff(moment(b.date, 'DD.MM.YYYY')));
    const adds = user.oil_adds;
    let avgMileage = 'Недостаточно данных';
    let avgDays = 'Недостаточно данных';
    let totalOil = 0;
    let avgOilPer1000 = 0;

    if (changes.length > 1) {
      const first = changes[0];
      const last = changes[changes.length - 1];
      const mileageDiff = last.mileage - first.mileage;
      if (mileageDiff > 0) {
        avgMileage = (mileageDiff / (changes.length - 1)).toFixed(0) + ' км';
      }
      const dateDiff = moment(last.date, 'DD.MM.YYYY').diff(moment(first.date, 'DD.MM.YYYY'), 'days');
      if (dateDiff > 0) {
        avgDays = (dateDiff / (changes.length - 1)).toFixed(0) + ' дней';
      }
    }
    totalOil = adds.reduce((sum, add) => sum + add.amount, 0);
    if (changes.length > 0 && adds.length > 0) {
      const totalMileage = changes[changes.length - 1].mileage - changes[0].mileage;
      avgOilPer1000 = totalMileage > 0 ? (totalOil / totalMileage) * 1000 : 0;
    }

    oilMessage = `Масло:\nСредний пробег между заменами: ${avgMileage}\nСреднее время: ${avgDays}\nСредний расход масла: ${avgOilPer1000.toFixed(2)} л/1000 км\nСредний долив: ${(totalOil / Math.max(1, changes.length - 1)).toFixed(2)} л`;

    // Ремонты
    let repairMessage = '';
    const repairs = user.repairs;
    if (repairs.length > 0) {
      const totalRepairCost = repairs.reduce((sum, r) => sum + r.repair_cost + r.parts.reduce((s, p) => s + p.cost, 0), 0);
      const categoryCosts = repairCategories.reduce((acc, cat) => {
        const catRepairs = repairs.filter(r => r.category === cat);
        const cost = catRepairs.reduce((sum, r) => sum + r.repair_cost + r.parts.reduce((s, p) => s + p.cost, 0), 0);
        return { ...acc, [cat]: { count: catRepairs.length, cost } };
      }, {});
      const avgRepairCost = repairs.length > 0 ? (totalRepairCost / repairs.length).toFixed(2) : 0;

      repairMessage = `\n\nРемонты:\nВсего ремонтов: ${repairs.length}\nОбщая стоимость: ${totalRepairCost} руб\nСредняя стоимость ремонта: ${avgRepairCost} руб\nПо категориям:`;
      for (const cat of repairCategories) {
        if (categoryCosts[cat].count > 0) {
          repairMessage += `\n- ${cat}: ${categoryCosts[cat].cost} руб (${categoryCosts[cat].count} ремонта)`;
        }
      }
    } else {
      repairMessage = '\n\nРемонты: нет данных';
    }

    ctx.reply(`${oilMessage}${repairMessage}`, mainMenu);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в full_history:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// История с последней замены
bot.action('last_history', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || user.oil_changes.length === 0) {
      ctx.reply('История пуста.', mainMenu);
      return;
    }

    const lastChange = user.oil_changes.sort((a, b) => moment(a.date, 'DD.MM.YYYY').diff(moment(b.date, 'DD.MM.YYYY')))[user.oil_changes.length - 1];
    const addsSinceLast = user.oil_adds.filter(add => moment(add.date, 'DD.MM.YYYY').isSameOrAfter(moment(lastChange.date, 'DD.MM.YYYY')));
    const totalOil = addsSinceLast.reduce((sum, add) => sum + add.amount, 0);
    const mileageSinceLast = user.last_mileage ? user.last_mileage.mileage - lastChange.mileage : 0;
    const avgOilPer1000 = mileageSinceLast > 0 ? (totalOil / mileageSinceLast) * 1000 : 0;
    const remaining = 7000 - mileageSinceLast;

    ctx.reply(`С последней замены (${lastChange.date}):\nРасход масла: ${avgOilPer1000.toFixed(2)} л/1000 км\nДолито: ${totalOil.toFixed(2)} л\nОстаток до замены: ${remaining > 0 ? remaining : 'Пора менять!'}${remaining > 0 ? ' км' : ''}`, mainMenu);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в last_history:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// История ремонтов
bot.action('repair_history', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || user.repairs.length === 0) {
      ctx.reply('История ремонтов пуста.', mainMenu);
      console.log(`[DEBUG] user.repairs is empty for user ${userId}`);
      return;
    }

    console.log(`[DEBUG] Found ${user.repairs.length} repairs for user ${userId}`);
    for (let i = 0; i < user.repairs.length; i++) {
      const r = user.repairs[i];
      const message = `Ремонт #${i + 1}:\nКатегория: ${r.category}\nДата: ${r.date}\nПробег: ${r.mileage} км\nЗапчасти: ${r.parts.length > 0 ? r.parts.map(p => `${p.name} (${p.cost} руб)`).join(', ') : 'нет'}\nСтоимость ремонта: ${r.repair_cost} руб\nКомментарий: ${r.comment || 'нет'}`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Редактировать', `edit_repair_${i}`), Markup.button.callback('Удалить', `delete_repair_${i}`)]
      ]);
      console.log(`[DEBUG] Sending repair #${i + 1} for user ${userId}, has photo: ${!!r.photo_id}`);
      if (r.photo_id) {
        await bot.telegram.sendPhoto(ctx.from.id, r.photo_id, { caption: message, reply_markup: keyboard.reply_markup });
      } else {
        await ctx.reply(message, keyboard);
      }
    }
    ctx.reply('Вернуться в меню:', mainMenu);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в repair_history:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Удаление ремонта
bot.action(/delete_repair_(\d+)/, async (ctx) => {
  try {
    const index = parseInt(ctx.match[1]);
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || index >= user.repairs.length) {
      ctx.reply('Ремонт не найден.', mainMenu);
      return;
    }
    user.repairs.splice(index, 1);
    await user.save();
    ctx.reply('Ремонт удален.', mainMenu);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в delete_repair:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Редактирование ремонта
bot.action(/edit_repair_(\d+)/, async (ctx) => {
  try {
    const index = parseInt(ctx.match[1]);
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || index >= user.repairs.length) {
      ctx.reply('Ремонт не найден.', mainMenu);
      return;
    }
    ctx.session.repair = user.repairs[index];
    ctx.session.repairIndex = index;
    ctx.reply('Выберите новую категорию ремонта:', repairCategoryKeyboard);
    ctx.session.step = 'edit_repair_category';
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в edit_repair:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Редактирование категории ремонта
bot.action(/category_(.+)/, async (ctx) => {
  try {
    if (ctx.session.step === 'edit_repair_category') {
      const category = ctx.match[1];
      if (!repairCategories.includes(category)) {
        ctx.reply('Неверная категория, выберите снова:', repairCategoryKeyboard);
        return;
      }
      ctx.session.repair.category = category;
      ctx.reply('Введите новую дату и время ремонта (например, 17.03.2025 14:00):');
      ctx.session.step = 'edit_repair_date';
      await ctx.answerCbQuery();
    }
  } catch (err) {
    console.error('Ошибка в edit_category:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Редактирование текстовых полей ремонта
bot.on('text', async (ctx) => {
  try {
    if (ctx.session.step === 'edit_repair_date') {
      if (!moment(ctx.message.text, 'DD.MM.YYYY HH:mm', true).isValid()) {
        ctx.reply('Неверный формат. Введите в формате DD.MM.YYYY HH:mm (например, 17.03.2025 14:00):');
        return;
      }
      ctx.session.repair.date = ctx.message.text;
      ctx.reply('Введите новый пробег на момент ремонта (в км):');
      ctx.session.step = 'edit_repair_mileage';
    } else if (ctx.session.step === 'edit_repair_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage) || mileage < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение пробега:');
        return;
      }
      ctx.session.repair.mileage = mileage;
      ctx.reply('Введите новое название запчасти (или "-" для очистки запчастей):');
      ctx.session.step = 'edit_repair_part_name';
    } else if (ctx.session.step === 'edit_repair_part_name') {
      ctx.session.repair.parts = [];
      if (ctx.message.text !== '-') {
        ctx.session.part = { name: ctx.message.text };
        ctx.reply('Введите новую стоимость запчасти (в рублях):');
        ctx.session.step = 'edit_repair_part_cost';
      } else {
        ctx.reply('Введите новую стоимость ремонта (в рублях):');
        ctx.session.step = 'edit_repair_cost';
      }
    } else if (ctx.session.step === 'edit_repair_part_cost') {
      const cost = Number(ctx.message.text);
      if (isNaN(cost) || cost < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение стоимости:');
        return;
      }
      ctx.session.part.cost = cost;
      ctx.session.repair.parts.push(ctx.session.part);
      ctx.reply('Добавить еще запчасть?', Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'edit_add_another_part')],
        [Markup.button.callback('Нет', 'edit_no_more_parts')]
      ]));
      ctx.session.step = 'edit_repair_add_part';
    } else if (ctx.session.step === 'edit_repair_cost') {
      const repair_cost = Number(ctx.message.text);
      if (isNaN(repair_cost) || repair_cost < 0) {
        ctx.reply('Пожалуйста, введите положительное числовое значение стоимости ремонта:');
        return;
      }
      ctx.session.repair.repair_cost = repair_cost;
      ctx.reply('Введите новый комментарий (или "-" для очистки):');
      ctx.session.step = 'edit_repair_comment';
    } else if (ctx.session.step === 'edit_repair_comment') {
      ctx.session.repair.comment = ctx.message.text === '-' ? '' : ctx.message.text;
      ctx.reply('Прикрепите новое фото (или "-" для пропуска):');
      ctx.session.step = 'edit_repair_photo';
    }
  } catch (err) {
    console.error('Ошибка редактирования текста:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка дополнительных запчастей при редактировании
bot.action('edit_add_another_part', async (ctx) => {
  try {
    ctx.reply('Введите название следующей запчасти:');
    ctx.session.step = 'edit_repair_part_name';
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в edit_add_another_part:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

bot.action('edit_no_more_parts', async (ctx) => {
  try {
    ctx.reply('Введите новую стоимость ремонта (в рублях):');
    ctx.session.step = 'edit_repair_cost';
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка в edit_no_more_parts:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка фото при редактировании
bot.on('photo', async (ctx) => {
  try {
    if (ctx.session.step === 'edit_repair_photo') {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      ctx.session.repair.photo_id = photo.file_id;
      ctx.session.user.repairs[ctx.session.repairIndex] = ctx.session.repair;
      await ctx.session.user.save();
      const r = ctx.session.repair;
      ctx.reply(`Ремонт обновлен:\nКатегория: ${r.category}\nДата: ${r.date}\nПробег: ${r.mileage} км\nЗапчасти: ${r.parts.length > 0 ? r.parts.map(p => `${p.name} (${p.cost} руб)`).join(', ') : 'нет'}\nСтоимость ремонта: ${r.repair_cost} руб\nКомментарий: ${r.comment || 'нет'}`, mainMenu);
      ctx.session.step = null;
      ctx.session.repair = null;
      ctx.session.repairIndex = null;
    }
  } catch (err) {
    console.error('Ошибка редактирования фото:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Пропуск фото при редактировании
bot.hears('-', async (ctx) => {
  try {
    if (ctx.session.step === 'edit_repair_photo') {
      ctx.session.repair.photo_id = '';
      ctx.session.user.repairs[ctx.session.repairIndex] = ctx.session.repair;
      await ctx.session.user.save();
      const r = ctx.session.repair;
      ctx.reply(`Ремонт обновлен:\nКатегория: ${r.category}\nДата: ${r.date}\nПробег: ${r.mileage} км\nЗапчасти: ${r.parts.length > 0 ? r.parts.map(p => `${p.name} (${p.cost} руб)`).join(', ') : 'нет'}\nСтоимость ремонта: ${r.repair_cost} руб\nКомментарий: ${r.comment || 'нет'}`, mainMenu);
      ctx.session.step = null;
      ctx.session.repair = null;
      ctx.session.repairIndex = null;
    }
  } catch (err) {
    console.error('Ошибка пропуска фото при редактировании:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Экспорт данных
bot.command('export', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || (user.oil_changes.length === 0 && user.oil_adds.length === 0 && user.repairs.length === 0)) {
      ctx.reply('Нет данных для экспорта.', mainMenu);
      return;
    }

    let csv = 'Type,Date,Category,PartName,PartCost,Mileage,RepairCost,Comment,OilName,OilAmount\n';
    user.oil_changes.forEach(c => {
      csv += `OilChange,${c.date},,,${c.mileage},,,${c.oil_name},\n`;
    });
    user.oil_adds.forEach(a => {
      csv += `OilAdd,${a.date},,,${a.mileage},,,,,${a.amount}\n`;
    });
    user.repairs.forEach(r => {
      if (r.parts.length === 0) {
        csv += `Repair,${r.date},${r.category},,0,${r.mileage},${r.repair_cost},${r.comment || ''},\n`;
      } else {
        r.parts.forEach(p => {
          csv += `Repair,${r.date},${r.category},${p.name},${p.cost},${r.mileage},${r.repair_cost},${r.comment || ''},\n`;
        });
      }
    });

    // Отправляем CSV как текст, чтобы избежать проблем с файлами на Render
    await ctx.replyWithDocument({
      source: Buffer.from(csv, 'utf-8'),
      filename: `export_${userId}_${Date.now()}.csv`
    });
    ctx.reply('Данные экспортированы.', mainMenu);
  } catch (err) {
    console.error('Ошибка экспорта:', err);
    ctx.reply('Произошла ошибка при экспорте. Попробуйте снова.', mainMenu);
  }
});

// Экспорт через кнопку
bot.action('export_data', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || (user.oil_changes.length === 0 && user.oil_adds.length === 0 && user.repairs.length === 0)) {
      ctx.reply('Нет данных для экспорта.', mainMenu);
      return;
    }

    let csv = 'Type,Date,Category,PartName,PartCost,Mileage,RepairCost,Comment,OilName,OilAmount\n';
    user.oil_changes.forEach(c => {
      csv += `OilChange,${c.date},,,${c.mileage},,,${c.oil_name},\n`;
    });
    user.oil_adds.forEach(a => {
      csv += `OilAdd,${a.date},,,${a.mileage},,,,,${a.amount}\n`;
    });
    user.repairs.forEach(r => {
      if (r.parts.length === 0) {
        csv += `Repair,${r.date},${r.category},,0,${r.mileage},${r.repair_cost},${r.comment || ''},\n`;
      } else {
        r.parts.forEach(p => {
          csv += `Repair,${r.date},${r.category},${p.name},${p.cost},${r.mileage},${r.repair_cost},${r.comment || ''},\n`;
        });
      }
    });

    await ctx.replyWithDocument({
      source: Buffer.from(csv, 'utf-8'),
      filename: `export_${userId}_${Date.now()}.csv`
    });
    ctx.reply('Данные экспортированы.', mainMenu);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ошибка экспорта через кнопку:', err);
    ctx.reply('Произошла ошибка при экспорте. Попробуйте снова.', mainMenu);
  }
});

// Автоматический запрос пробега каждые 4 недели
cron.schedule('0 0 * * 0', async () => {
  try {
    console.log('Проверка автоматического запроса пробега');
    const now = new Date();
    const users = await User.find();
    for (const user of users) {
      const lastRequest = user.last_request || new Date(0);
      if ((now - lastRequest) / (1000 * 60 * 60 * 24) >= 28) {
        await bot.telegram.sendMessage(user.user_id, 'Пожалуйста, введите текущий пробег:', Markup.inlineKeyboard([
          [Markup.button.callback('Ввести пробег', 'enter_mileage')]
        ]));
        user.last_request = now;
        await user.save();
      }
    }
  } catch (err) {
    console.error('Ошибка в cron:', err);
  }
});

// Настройка вебхука
bot.telegram.setWebhook(`https://car-maintenance-bot.onrender.com/api/bot`)
  .then(() => {
    console.log('Вебхук успешно установлен');
  })
  .catch(err => {
    console.error('Ошибка установки вебхука:', err);
  });

// Запуск сервера
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});