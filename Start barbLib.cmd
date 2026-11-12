@echo off
rem Starts barbLib on http://localhost:8642 and opens it in your browser.
rem Keep this window open while reading. In Edge/Chrome use "Install app" to get a desktop app.
cd /d "%~dp0"
start "" http://localhost:8642/
python tools\serve.py 8642
