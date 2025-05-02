require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const cron = require('node-cron');
const mongoose = require('mongoose');

console.log('Запуск бота...');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'Установлен' : 'Не установлен');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Установлен' : 'Не установлен');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB подключен'))
  .catch(err => console.error('Ошибка MongoDB:', err));

// Схема пользователя
const UserSchema = new mongoose.Schema({
  user_id: { type: Number, required: true, unique: true },
  oil_changes: [{ date: String, mileage: Number, oil_name: String }],
  oil_adds: [{ date: String, mileage: Number, amount: Number }],
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
  [Markup.button.callback('Ввести текущий пробег', 'enter_mileage')],
  [Markup.button.callback('История (полная)', 'full_history')],
  [Markup.button.callback('История (с последней замены)', 'last_history')],
]);

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
    if (!user) user = new User({ user_id: userId, oil_changes: [], oil_adds: [] });
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
    if (!user) user = new User({ user_id: userId, oil_changes: [], oil_adds: [] });
    ctx.reply('Введите дату долива (например, 17.03.2025):');
    ctx.session.step = 'add_date';
    ctx.session.user = user;
  } catch (err) {
    console.error('Ошибка в add_oil:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

// Обработка "Ввести текущий пробег"
bot.action('enter_mileage', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await User.findOne({ user_id: userId });
    if (!user) user = new User({ user_id: userId, oil_changes: [], oil_adds: [] });
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
      ctx.session.date = ctx.message.text;
      ctx.reply('Введите пробег на момент замены (в км):');
      ctx.session.step = 'replace_mileage';
    } else if (ctx.session.step === 'replace_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage)) {
        ctx.reply('Пожалуйста, введите числовое значение пробега:');
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
      ctx.session.date = ctx.message.text;
      ctx.reply('Введите пробег на момент долива (в км):');
      ctx.session.step = 'add_mileage';
    } else if (ctx.session.step === 'add_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage)) {
        ctx.reply('Пожалуйста, введите числовое значение пробега:');
        return;
      }
      ctx.session.mileage = mileage;
      ctx.reply('Введите количество долитого масла (в литрах):');
      ctx.session.step = 'add_amount';
    } else if (ctx.session.step === 'add_amount') {
      const amount = Number(ctx.message.text);
      if (isNaN(amount)) {
        ctx.reply('Пожалуйста, введите числовое значение количества масла:');
        return;
      }
      const oilAdd = { date: ctx.session.date, mileage: ctx.session.mileage, amount };
      user.oil_adds.push(oilAdd);
      await user.save();
      ctx.reply(`Данные сохранены:\nДата: ${oilAdd.date}\nПробег: ${oilAdd.mileage} км\nКоличество: ${oilAdd.amount} л`, mainMenu);
      ctx.session.step = null;
    }

    // Ввод текущего пробега
    else if (ctx.session.step === 'enter_mileage') {
      const mileage = Number(ctx.message.text);
      if (isNaN(mileage)) {
        ctx.reply('Пожалуйста, введите числовое значение пробега:');
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

// Обработка ответа на вопрос о доливе
bot.action('add_oil_after_check', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let user = await User.findOne({ user_id: userId });
    ctx.session.user = user;
    ctx.session.step = 'add_date';
    ctx.reply('Введите дату долива (например, 17.03.2025):');
  } catch (err) {
    console.error('Ошибка в add_oil_after_check:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
  }
});

bot.action('no_oil_added', (ctx) => {
  ctx.reply('Хорошо, уровень масла проверен.', mainMenu);
});

// Полная история
bot.action('full_history', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const user = await User.findOne({ user_id: userId });
    if (!user || user.oil_changes.length === 0) {
      ctx.reply('История пуста.', mainMenu);
      return;
    }

    const changes = user.oil_changes;
    const adds = user.oil_adds;
    let avgMileage = 0, avgDays = 0, totalOil = 0, avgOilPer1000 = 0;
    if (changes.length > 1) {
      avgMileage = (changes[changes.length - 1].mileage - changes[0].mileage) / (changes.length - 1);
      const days = (new Date(changes[changes.length - 1].date) - new Date(changes[0].date)) / (1000 * 60 * 60 * 24);
      avgDays = days / (changes.length - 1);
    }
    totalOil = adds.reduce((sum, add) => sum + add.amount, 0);
    if (changes.length > 0 && adds.length > 0) {
      const totalMileage = changes[changes.length - 1].mileage - changes[0].mileage;
      avgOilPer1000 = totalMileage > 0 ? (totalOil / totalMileage) * 1000 : 0;
    }

    ctx.reply(`Полная история:\nСредний пробег между заменами: ${avgMileage.toFixed(0)} км\nСреднее время: ${avgDays.toFixed(0)} дней\nСредний расход масла: ${avgOilPer1000.toFixed(2)} л/1000 км\nСредний долив: ${(totalOil / Math.max(1, changes.length - 1)).toFixed(2)} л`, mainMenu);
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

    const lastChange = user.oil_changes[user.oil_changes.length - 1];
    const addsSinceLast = user.oil_adds.filter(add => new Date(add.date) >= new Date(lastChange.date));
    const totalOil = addsSinceLast.reduce((sum, add) => sum + add.amount, 0);
    const mileageSinceLast = user.last_mileage ? user.last_mileage.mileage - lastChange.mileage : 0;
    const avgOilPer1000 = mileageSinceLast > 0 ? (totalOil / mileageSinceLast) * 1000 : 0;
    const remaining = 7000 - mileageSinceLast;

    ctx.reply(`С последней замены (${lastChange.date}):\nРасход масла: ${avgOilPer1000.toFixed(2)} л/1000 км\nДолито: ${totalOil.toFixed(2)} л\nОстаток до замены: ${remaining > 0 ? remaining : 'Пора менять!'}${remaining > 0 ? ' км' : ''}`, mainMenu);
  } catch (err) {
    console.error('Ошибка в last_history:', err);
    ctx.reply('Произошла ошибка, попробуйте снова.');
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
bot.telegram.setWebhook(`https://car-maintenance-bot.onrender.com`)
  .then(() => {
    console.log('Вебхук успешно установлен');
  })
  .catch(err => {
    console.error('Ошибка установки вебхука:', err);
  });

// Обработчик для Render
module.exports = async (req, res) => {
  try {
    console.log('Получен запрос от Telegram:', req.body);
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Ошибка обработки запроса:', err);
    res.status(500).send('Internal Server Error');
  }
};