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
from backend import BackendClient, BackendError
from config import load_settings
from messages import (
    AI_NOT_CONFIGURED_TEXT, AI_TEMPORARY_ERROR_TEXT, BACKEND_NOT_CONFIGURED_TEXT,
    BACKEND_TEMPORARY_ERROR_TEXT, HELP_TEXT, LOCAL_PRIVACY_TEXT, LOCAL_RESET_TEXT,
    MEMORY_SAVED_TEXT, PRIVACY_TEXT, REMEMBER_USAGE_TEXT, RESET_TEXT, WELCOME_TEXT,
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
        backend = context.application.bot_data.get("backend")
        await update.effective_message.reply_text(PRIVACY_TEXT if backend else LOCAL_PRIVACY_TEXT)


async def reset_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user, message = update.effective_user, update.effective_message
    if not user or not message:
        return
    backend = context.application.bot_data.get("backend")
    if backend:
        try:
            await backend.clear_conversation(user.id)
        except BackendError:
            await message.reply_text(BACKEND_TEMPORARY_ERROR_TEXT)
            return
        await message.reply_text(RESET_TEXT)
        return

    context.application.bot_data["conversations"].clear(user.id)
    await message.reply_text(LOCAL_RESET_TEXT)


async def remember_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user, message = update.effective_user, update.effective_message
    if not user or not message:
        return
    backend = context.application.bot_data.get("backend")
    if not backend:
        await message.reply_text(BACKEND_NOT_CONFIGURED_TEXT)
        return
    content = " ".join(context.args).strip()
    if not content:
        await message.reply_text(REMEMBER_USAGE_TEXT)
        return
    if len(content) > 1000:
        await message.reply_text("Заметка слишком длинная. Максимум 1000 символов.")
        return
    try:
        await backend.save_memory(user.id, content)
    except BackendError:
        await message.reply_text(BACKEND_TEMPORARY_ERROR_TEXT)
        return
    await message.reply_text(MEMORY_SAVED_TEXT)


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message, user = update.effective_message, update.effective_user
    if not message or not user:
        return
    client = context.application.bot_data["ai_client"]
    backend = context.application.bot_data.get("backend")
    conversations = context.application.bot_data["conversations"]
    if not client.api_key:
        await message.reply_text(AI_NOT_CONFIGURED_TEXT)
        return

    user_text = message.text or ""
    try:
        await context.bot.send_chat_action(chat_id=message.chat_id, action=ChatAction.TYPING)
        if backend:
            stored_context = await backend.get_context(user.id, user_text)
            history = stored_context["messages"]
            personalization_context = stored_context["personalization_context"]
        else:
            history = conversations.get(user.id)
            personalization_context = ""
        answer = await client.answer(user_text, history, personalization_context)
    except BackendError:
        logger.warning("ORVEX backend context request failed")
        await message.reply_text(BACKEND_TEMPORARY_ERROR_TEXT)
        return
    except AIConfigurationError:
        await message.reply_text(AI_NOT_CONFIGURED_TEXT)
        return
    except AIProviderError as exc:
        logger.warning("AI provider request failed (%s)", type(exc).__name__)
        await message.reply_text(AI_TEMPORARY_ERROR_TEXT)
        return
    except Exception as exc:
        logger.error("Message handler failed (%s)", type(exc).__name__)
        await message.reply_text(AI_TEMPORARY_ERROR_TEXT)
        return

    if backend:
        try:
            await backend.save_exchange(user.id, user_text, answer)
        except BackendError:
            logger.warning("ORVEX backend could not save the conversation exchange")
            answer += "\n\nИсторию этого ответа не удалось сохранить в ORVEX."
    else:
        conversations.add_exchange(user.id, user_text, answer)

    for offset in range(0, len(answer), 4000):
        await message.reply_text(answer[offset:offset + 4000])


async def post_init(application: Application) -> None:
    settings = application.bot_data["settings"]
    await application.bot.set_my_commands([
        BotCommand("start", "Запустить ORVEX"),
        BotCommand("app", "Открыть центр управления"),
        BotCommand("reset", "Очистить историю диалога"),
        BotCommand("remember", "Сохранить заметку в память"),
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
    application.bot_data["backend"] = (
        BackendClient(settings.orvex_api_url, settings.orvex_bot_api_secret)
        if settings.orvex_bot_api_secret else None
    )
    application.bot_data["conversations"] = ConversationStore()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("app", open_app))
    application.add_handler(CommandHandler("reset", reset_command))
    application.add_handler(CommandHandler("remember", remember_command))
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
