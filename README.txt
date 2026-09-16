AI TEACHER - B.TECH SUBJECT BOOK AI

1. Install Node.js LTS.
2. Rename .env.example to .env.
3. Put your private ADMIN_PASSWORD and AI_API_KEY in .env.
4. Open Command Prompt in this folder.
5. Run: npm install
6. Run: npm start
7. Student site: http://localhost:3000
8. Private admin: http://localhost:3000/admin

Admin uploads each subject PDF once. Students select a subject and ask questions.
The API key is server-side and is not placed in the HTML.

Starter limitation: up to 120,000 characters of the saved book are sent with each question. For very large books, upgrade to RAG/vector search.
Scanned image-only PDFs need OCR.
