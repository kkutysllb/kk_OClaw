@echo off
REM setup.bat — KKOCLAW Desktop development environment setup (Windows)
REM
REM Usage:
REM   cd desktop
REM   setup.bat          Full setup
REM   setup.bat --check  Only check prerequisites

setlocal enabledelayedexpansion

echo.
echo ==========================================
echo   KKOCLAW Desktop - Environment Setup
echo ==========================================
echo.

set ERRORS=0

REM ── 1. Rust toolchain ────────────────────────────────────────────────
echo Checking Rust toolchain...
where rustc >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%v in ('rustc --version') do echo [OK]   Rust: %%v
) else (
    echo [ERR]  Rust not found. Install via: https://rustup.rs
    set /a ERRORS+=1
)

REM ── 2. Python ────────────────────────────────────────────────────────
echo Checking Python...
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK]   %%v
) else (
    echo [ERR]  Python not found. Install Python 3.12+ from https://python.org
    set /a ERRORS+=1
)

REM ── 3. uv ────────────────────────────────────────────────────────────
echo Checking uv...
where uv >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%v in ('uv --version') do echo [OK]   uv: %%v
) else (
    echo [ERR]  uv not found. Install via: pip install uv
    set /a ERRORS+=1
)

REM ── 4. pnpm ──────────────────────────────────────────────────────────
echo Checking pnpm...
where pnpm >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%v in ('pnpm --version') do echo [OK]   pnpm: %%v
) else (
    echo [ERR]  pnpm not found. Install via: npm install -g pnpm
    set /a ERRORS+=1
)

REM ── Install dependencies (unless --check) ────────────────────────────
if "%1"=="--check" goto :summary

echo.
echo Installing backend dependencies...
cd ..\backend
uv sync
echo [OK]   Backend dependencies installed

echo Installing frontend dependencies...
cd ..\frontend
pnpm install
echo [OK]   Frontend dependencies installed

echo Installing desktop dependencies...
cd ..\desktop
pnpm install
echo [OK]   Desktop dependencies installed

:summary
echo.
if %ERRORS% equ 0 (
    echo [OK]   All prerequisites satisfied!
    echo.
    echo To start development:
    echo   cd desktop
    echo   pnpm dev
    echo.
) else (
    echo [ERR]  %ERRORS% prerequisite(s^) missing. Please install them and re-run.
    exit /b 1
)

endlocal
