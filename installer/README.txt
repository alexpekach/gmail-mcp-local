gmail-mcp-local  —  installer
=================================

Requires Node.js (LTS). If you don't have it, install from https://nodejs.org first
(then reopen your terminal / file window).

INSTALL
-------
Windows:  double-click  install.cmd
          If SmartScreen warns:  "More info"  ->  "Run anyway".

macOS:    double-click  install.command
          If macOS blocks it ("unidentified developer"):
             right-click the file  ->  Open  ->  Open.
          If double-click does nothing, open Terminal in this folder and run:
             chmod +x install.command && ./install.command

WHAT IT DOES
------------
- Copies the app into:   ~/.gmail-mcp-local/app   (Windows: %USERPROFILE%\.gmail-mcp-local\app)
- Installs its keychain helper (so your Google login is stored in your OS keychain)
- Adds "gmail-local" to your Claude Desktop / Cursor MCP config (your old config is backed up to .bak)

AFTER IT FINISHES
-----------------
1) Fully quit and reopen Claude Desktop (or Cursor).
2) In the chat:   connect_account({ ref: "work" })
   Sign in with your Google account and click Allow.
   (You may see a "Google hasn't verified this app" screen during the test period:
    click  Advanced  ->  Go to ... (unsafe)  ->  Allow.  This is expected for testers.)
3) Try:   "show my 5 latest threads on my work account"

PRIVACY
-------
Everything runs on THIS computer. Your email and your Google login token are stored
in your operating system's keychain and never sent to any server.

UNINSTALL
---------
1) In the client chat:  remove_account({ ref: "work" })
2) Delete the folder:   ~/.gmail-mcp-local   (Windows: %USERPROFILE%\.gmail-mcp-local)
3) Remove the "gmail-local" entry from your MCP client config (a .bak backup sits next to it)
4) Revoke access at  https://myaccount.google.com/permissions
