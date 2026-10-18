from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class BotInteractionLogBase(BaseModel):
    sender: str = "telegram_user"
    channel: str = "telegram"
    user_query: str
    bot_response: str
    tools_called: Optional[str] = None
    status: str = "SUCCESS"


class BotInteractionLogCreate(BotInteractionLogBase):
    pass


class BotInteractionLogUpdate(BaseModel):
    bot_response: Optional[str] = None
    tools_called: Optional[str] = None
    status: Optional[str] = None


class BotInteractionLogRead(BotInteractionLogBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
