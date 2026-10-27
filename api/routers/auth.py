from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from auth import verify_credentials, create_access_token, get_current_user, TokenResponse, UserPayload
from fastapi import Depends

router = APIRouter(prefix="/auth", tags=["Autenticación"])

class LoginRequest(BaseModel):
    username: str
    password: str

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    user = verify_credentials(req.username, req.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas. Verifique usuario y contraseña.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.username, "role": user.role})
    return TokenResponse(
        access_token=access_token,
        role=user.role,
        username=user.username
    )

@router.get("/me", response_model=UserPayload)
def get_profile(current_user: UserPayload = Depends(get_current_user)):
    return current_user
