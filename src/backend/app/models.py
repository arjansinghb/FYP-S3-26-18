"""Request/response shapes (Pydantic). These define the API's contract."""
from typing import Literal, Optional
from pydantic import BaseModel, Field

AgeBand = Literal["5-8", "9-12"]
ContentType = Literal["book", "video"]

# ----- accounts / auth -----


class SignupRequest(BaseModel):
    email: str
    password: str = Field(min_length=6)
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AccountOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    verified: bool


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6)


class AuthOut(BaseModel):
    token: str
    account: AccountOut


# ----- child profiles -----


class ChildCreate(BaseModel):
    name: str
    age_band: AgeBand
    reading_level: Optional[str] = None
    pin: str = Field(min_length=4, max_length=6)


class ChildUpdate(BaseModel):
    name: Optional[str] = None
    age_band: Optional[AgeBand] = None
    reading_level: Optional[str] = None
    pin: Optional[str] = None


class ChildSettings(BaseModel):
    allow_books: bool = True
    allow_videos: bool = True
    block_external_links: bool = True


class ChildOut(BaseModel):
    id: str
    parent_id: str
    name: str
    age_band: AgeBand
    reading_level: Optional[str]
    linking_code: str
    avatar: str
    settings: ChildSettings


class ChildLinkRequest(BaseModel):
    code: str
    pin: str


class ChildSessionOut(BaseModel):
    token: str
    child: ChildOut


# ----- content catalogue -----


class ContentIn(BaseModel):
    type: ContentType
    title: str
    description: str
    age_bands: list[AgeBand]
    genres: list[str] = []
    reading_level: Optional[str] = None
    source: str = "manual"
    external_ref: Optional[str] = None


class ContentOut(ContentIn):
    id: str
    status: Literal["approved", "pending", "rejected"]


# ----- chat / recommendations -----


class ChatRequest(BaseModel):
    message: str


class Recommendation(BaseModel):
    id: str
    type: ContentType
    title: str
    explanation: str
    description: str = ""
    external_ref: Optional[str] = None  # YouTube id for videos, once curated


class ChatResponse(BaseModel):
    reply: str
    recommendations: list[Recommendation] = []


class AvatarUpdate(BaseModel):
    avatar: str


class FeedbackRequest(BaseModel):
    content_id: str
    liked: bool


class ReportRequest(BaseModel):
    content_id: str
    reason: str


class ReportOut(BaseModel):
    id: str
    content_id: str
    content_title: str
    reason: str
    status: str
    ts: float


class ResolveReport(BaseModel):
    action: Literal["dismiss", "remove"] = "dismiss"
