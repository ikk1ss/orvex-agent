"""Telegram entry point for ORVEX Agent."""
import logging
from telegram import (
    BotCommand, InlineKeyboardButton, InlineKeyboardMarkup,
    MenuButtonWebApp, Update, WebAppInfo,
)
from telegram.constants import ChatAction
from telegram.ext import (
    Application, ApplicationBuilder, CommandHandler,
    ContextTypes, MessageHandler, filters,
)
from ai import AIConfigurationError, AIProviderError, ConversationStore, OpenRouterClient
from config import load_settings
from messages import (
    AI_NOT_CONFIGURED_TEXT, AI_TEMPORARY_ERROR_TEXT, HELP_TEXT,
    PRIVACY_TEXT, RESET_TEXT, WELCOME_TEXT,
)

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
            WELCOME_TEXT, reply_markup=app_keyboard(settings.webapp_url)
        )


async def open_app(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    settings = context.application.bot_data["settings"]
    if update.effective_message:
        await update.effective_message.reply_text(
            "Открыть центр управления ORVEX можно здесь.",
            reply_markup=app_keyboard(settings.webapp_url),
        )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(HELP_TEXT)


async def privacy_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(PRIVACY_TEXT)


async def reset_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user and update.effective_message:
        context.application.bot_data["conversations"].clear(update.effective_user.id)
        await update.effective_message.reply_text(RESET_TEXT)


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message, user = update.effective_message, update.effective_user
    if not message or not user:
        return
    client = context.application.bot_data["ai_client"]
    conversations = context.application.bot_data["conversations"]
    if not client.api_key:
        await message.reply_text(AI_NOT_CONFIGURED_TEXT)
        return
    try:
        await context.bot.send_chat_action(chat_id=message.chat_id, action=ChatAction.TYPING)
        history = conversations.get(user.id)
        user_text = message.text or ""
        answer = await client.answer(user_text, history)
        conversations.add_exchange(user.id, user_text, answer)
        for offset in range(0, len(answer), 4000):
            await message.reply_text(answer[offset:offset + 4000])
    except AIConfigurationError:
        await message.reply_text(AI_NOT_CONFIGURED_TEXT)
    except AIProviderError as exc:
        logger.warning("AI provider request failed (%s)", type(exc).__name__)
        await message.reply_text(AI_TEMPORARY_ERROR_TEXT)
    except Exception as exc:
        logger.error("Message handler failed (%s)", type(exc).__name__)
        await message.reply_text(AI_TEMPORARY_ERROR_TEXT)


async def post_init(application: Application) -> None:
    settings = application.bot_data["settings"]
    await application.bot.set_my_commands([
        BotCommand("start", "Запустить ORVEX"),
        BotCommand("app", "Открыть центр управления"),
        BotCommand("reset", "Очистить контекст диалога"),
        BotCommand("help", "Справка"),
        BotCommand("privacy", "Обработка данных"),
    ])
    await application.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="Открыть ORVEX", web_app=WebAppInfo(url=settings.webapp_url)
        )
    )


async def handle_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.error("Telegram update failed (%s)", type(context.error).__name__)


def build_application() -> Application:
    settings = load_settings()
    application = (
        ApplicationBuilder().token(settings.telegram_bot_token)
        .post_init(post_init).build()
    )
    application.bot_data["settings"] = settings
    application.bot_data["ai_client"] = OpenRouterClient(
        api_key=settings.openrouter_api_key, model=settings.ai_model
    )
    application.bot_data["conversations"] = ConversationStore()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("app", open_app))
    application.add_handler(CommandHandler("reset", reset_command))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("privacy", privacy_command))
    application.add_handler(MessageHandler(
        filters.ChatType.PRIVATE & filters.TEXT & ~filters.COMMAND, handle_text
    ))
    application.add_error_handler(handle_error)
    return application


def main() -> None:
    application = build_application()
    logger.info("ORVEX Agent Telegram bot is starting")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
