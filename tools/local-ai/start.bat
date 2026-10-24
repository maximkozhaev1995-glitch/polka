@echo off
chcp 65001 >nul
title Полка: ИИ на этом компьютере
cd /d "%~dp0"
python polka_ai.py
pause
