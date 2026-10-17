# Public frontend files

This archive contains the static, browser-facing files from the original `public/` folder, moved to the archive root for a separate public frontend repository.

## Important

- These files are meant to be public. Browser code, images, game assets, and site text can be downloaded by visitors.
- The original archive also contained server-side code and private chat/backend implementation. Those files were intentionally left out. In particular, `public/index.js` was a Node.js server entry point despite its location inside `public/`.
- This is only the frontend. Proxy services, chat APIs, websocket endpoints, and other server features need a separately hosted backend. Do not put backend credentials or `.env` files in this public repository.
- A static frontend host such as GitHub Pages can serve the website. jsDelivr is an asset CDN and does not host a normal HTML site as a website entry point; you can use it to serve individual files from a public repository.
- Before publishing, review any third-party game files and assets for their redistribution terms.