"""Telegram entry point for ORVEX Agent.

This bot launches the ORVEX Agent Mini App. AI requests are intentionally
not implemented here; they will be added after the provider/backend stage.
"""
import logging

from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from config import load_settings
from messages import HELP_TEXT, PRIVACY_TEXT, UNKNOWN_TEXT, WELCOME_TEXT

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("orvex.telegram")


def app_keyboard(webapp_url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Открыть ORVEX Agent", web_app=WebAppInfo(url=webapp_url))]]
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings = context.application.bot_data["settings"]
    if update.effective_message:
        await update.effective_message.reply_text(
            WELCOME_TEXT,
            reply_markup=app_keyboard(settings.webapp_url),
        )


async def open_app(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings = context.application.bot_data["settings"]
    if update.effective_message:
        await update.effective_message.reply_text(
            "Нажмите кнопку, чтобы открыть приложение.",
            reply_markup=app_keyboard(settings.webapp_url),
        )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(HELP_TEXT)


async def privacy_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(PRIVACY_TEXT)


async def unknown_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(UNKNOWN_TEXT)


async def post_init(application: Application) -> None:
    settings = application.bot_data["settings"]
    await application.bot.set_my_commands(
        [
            BotCommand("start", "Запустить ORVEX Agent"),
            BotCommand("app", "Открыть приложение"),
            BotCommand("help", "Справка"),
            BotCommand("privacy", "Обработка данных"),
        ]
    )
    await application.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="Открыть ORVEX",
            web_app=WebAppInfo(url=settings.webapp_url),
        )
    )


async def handle_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    # Do not log exception strings: upstream request errors can contain URLs.
    logger.error("Telegram update failed (%s)", type(context.error).__name__)


def build_application() -> Application:
    settings = load_settings()
    application = (
        ApplicationBuilder()
        .token(settings.telegram_bot_token)
        .post_init(post_init)
        .build()
    )
    application.bot_data["settings"] = settings
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("app", open_app))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("privacy", privacy_command))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, unknown_message))
    application.add_error_handler(handle_error)
    return application


def main() -> None:
    application = build_application()
    logger.info("ORVEX Agent Telegram launcher is starting")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
