require("dotenv").config();

const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

// ===============================
// ENVIRONMENT
// ===============================

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const GEMINI_API_KEY = process.env.AI_API_KEY;

const GEMINI_MODEL = (
  process.env.AI_MODEL || "gemini-3.6-flash"
)
  .trim()
  .replace(/^models\//, "")
  .replace(/^=/, "");

console.log(
  "ADMIN_PASSWORD loaded:",
  ADMIN_PASSWORD ? "YES" : "NO"
);

console.log(
  "GEMINI_API_KEY loaded:",
  GEMINI_API_KEY ? "YES" : "NO"
);

console.log(
  "GEMINI_MODEL:",
  GEMINI_MODEL
);

// ===============================
// FOLDERS
// ===============================

const DATA_DIR = path.join(__dirname, "data");
const BOOKS_DIR = path.join(DATA_DIR, "books");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const CHUNKS_DIR = path.join(DATA_DIR, "chunks");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BOOKS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(CHUNKS_DIR, { recursive: true });

// ===============================
// RAG SETTINGS
// ===============================

const CHUNK_SIZE = 2500;
const CHUNK_OVERLAP = 300;
const TOP_K_CHUNKS = 5;

// ===============================
// SUBJECT DATABASE
// ===============================

const SUBJECTS_FILE = path.join(
  DATA_DIR,
  "subjects.json"
);

function loadSubjects() {

  if (!fs.existsSync(SUBJECTS_FILE)) {
    return [];
  }

  try {

    return JSON.parse(
      fs.readFileSync(
        SUBJECTS_FILE,
        "utf8"
      )
    );

  } catch (error) {

    console.error(
      "Could not read subjects.json:",
      error
    );

    return [];
  }
}

function saveSubjects(subjects) {

  fs.writeFileSync(
    SUBJECTS_FILE,
    JSON.stringify(
      subjects,
      null,
      2
    ),
    "utf8"
  );
}

// ===============================
// TEXT CHUNKING
// ===============================

function createTextChunks(text) {

  const chunks = [];

  let start = 0;

  while (start < text.length) {

    const end = Math.min(
      start + CHUNK_SIZE,
      text.length
    );

    const chunk = text
      .slice(start, end)
      .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

// ===============================
// SAVE CHUNKS
// ===============================

function saveSubjectChunks(
  subjectId,
  text
) {

  const chunks =
    createTextChunks(text);

  const chunksPath = path.join(
    CHUNKS_DIR,
    `${subjectId}.json`
  );

  const chunkData = {

    subjectId,

    totalChunks:
      chunks.length,

    chunkSize:
      CHUNK_SIZE,

    chunkOverlap:
      CHUNK_OVERLAP,

    createdAt:
      new Date().toISOString(),

    chunks:
      chunks.map(
        (content, index) => ({

          id:
            index + 1,

          content

        })
      )

  };

  fs.writeFileSync(
    chunksPath,
    JSON.stringify(
      chunkData,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `Created ${chunks.length} chunks for subject ${subjectId}`
  );

  return chunks.length;
}

// ===============================
// LOAD CHUNKS
// ===============================

function loadSubjectChunks(
  subjectId
) {

  const chunksPath = path.join(
    CHUNKS_DIR,
    `${subjectId}.json`
  );

  if (!fs.existsSync(chunksPath)) {
    return [];
  }

  try {

    const data =
      JSON.parse(
        fs.readFileSync(
          chunksPath,
          "utf8"
        )
      );

    return data.chunks || [];

  } catch (error) {

    console.error(
      "Could not read chunks:",
      error
    );

    return [];
  }
}

// ===============================
// TOKENIZE
// ===============================

function tokenize(text) {

  const STOP_WORDS = new Set([

    "a",
    "an",
    "the",
    "is",
    "are",
    "was",
    "were",

    "what",
    "which",
    "who",
    "when",
    "where",
    "why",
    "how",

    "do",
    "does",
    "did",

    "can",
    "could",
    "would",
    "should",
    "will",
    "shall",

    "to",
    "of",
    "in",
    "on",
    "for",
    "from",
    "with",
    "by",

    "and",
    "or",
    "but",
    "as",
    "at",

    "it",
    "this",
    "that",
    "these",
    "those",

    "be",
    "being",
    "been",

    "explain",
    "tell",
    "me",
    "about"

  ]);

  return String(text)
    .toLowerCase()
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 3 &&
        !STOP_WORDS.has(word)
    );
}

// ===============================
// RAG SEARCH
// ===============================

function searchRelevantChunks(
  chunks,
  question
) {

  const questionWords =
    tokenize(question);

  if (
    questionWords.length === 0
  ) {
    return [];
  }

  const uniqueQuestionWords =
    [...new Set(questionWords)];

  const scoredChunks =
    chunks.map((chunk) => {

      const chunkWords =
        tokenize(chunk.content);

      const chunkWordSet =
        new Set(chunkWords);

      let score = 0;

      for (
        const word
        of uniqueQuestionWords
      ) {

        if (
          chunkWordSet.has(word)
        ) {

          score += 2;
        }
      }

      // Exact question phrase bonus
      const normalizedQuestion =
        String(question)
          .toLowerCase()
          .replace(
            /[^a-z0-9\s]/g,
            " "
          )
          .replace(/\s+/g, " ")
          .trim();

      const normalizedChunk =
        String(chunk.content)
          .toLowerCase()
          .replace(
            /[^a-z0-9\s]/g,
            " "
          )
          .replace(/\s+/g, " ");

      if (
        normalizedQuestion.length >= 4 &&
        normalizedChunk.includes(
          normalizedQuestion
        )
      ) {

        score += 5;
      }

      return {
        ...chunk,
        score
      };

    });

  return scoredChunks
    .filter(
      (chunk) =>
        chunk.score >= 2
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      TOP_K_CHUNKS
    );
}

// ===============================
// EXPRESS
// ===============================

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

// ===============================
// PDF UPLOAD
// ===============================

const storage =
  multer.diskStorage({

    destination:
      function (
        req,
        file,
        cb
      ) {

        cb(
          null,
          UPLOADS_DIR
        );

      },

    filename:
      function (
        req,
        file,
        cb
      ) {

        const safeName =
          Date.now() +
          "-" +
          crypto.randomUUID() +
          "-" +
          file.originalname.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );

        cb(
          null,
          safeName
        );

      }

  });

const upload =
  multer({

    storage,

    limits: {

      fileSize:
        25 *
        1024 *
        1024

    },

    fileFilter:
      function (
        req,
        file,
        cb
      ) {

        const isPDF =
          file.mimetype ===
            "application/pdf" ||
          file.originalname
            .toLowerCase()
            .endsWith(
              ".pdf"
            );

        if (!isPDF) {

          return cb(
            new Error(
              "Only PDF files are allowed."
            )
          );
        }

        cb(
          null,
          true
        );
      }

  });

// ===============================
// ADMIN TOKEN
// ===============================

let adminToken = null;

function requireAdmin(
  req,
  res,
  next
) {

  const token =
    req.headers[
      "x-admin-token"
    ];

  if (
    !token ||
    token !== adminToken
  ) {

    return res
      .status(401)
      .json({

        error:
          "Unauthorized. Please login as admin."

      });
  }

  next();
}

// ===============================
// SUBJECT LIST
// ===============================

app.get(
  "/api/subjects",
  (req, res) => {

    const subjects =
      loadSubjects();

    res.json(
      subjects.map(
        (subject) => ({

          id:
            subject.id,

          name:
            subject.name

        })
      )
    );
  }
);

// ===============================
// ADMIN LOGIN
// ===============================

app.post(
  "/api/admin/login",
  (req, res) => {

    const {
      password
    } = req.body;

    if (
      !ADMIN_PASSWORD
    ) {

      return res
        .status(500)
        .json({

          error:
            "ADMIN_PASSWORD is not configured in .env"

        });
    }

    if (
      password !==
      ADMIN_PASSWORD
    ) {

      return res
        .status(401)
        .json({

          error:
            "Wrong admin password."

        });
    }

    adminToken =
      crypto
        .randomBytes(32)
        .toString("hex");

    res.json({

      success:
        true,

      token:
        adminToken

    });
  }
);

// ===============================
// ADMIN SUBJECTS
// ===============================

app.get(
  "/api/admin/subjects",
  requireAdmin,
  (req, res) => {

    const subjects =
      loadSubjects();

    res.json(
      subjects
    );
  }
);

// ===============================
// UPLOAD BOOK
// ===============================

app.post(
  "/api/admin/upload",

  requireAdmin,

  upload.single("book"),

  async (
    req,
    res
  ) => {

    try {

      if (!req.file) {

        return res
          .status(400)
          .json({

            error:
              "Please upload a PDF book."

          });
      }

      const subjectName =
        String(
          req.body.subjectName ||
          ""
        ).trim();

      if (!subjectName) {

        return res
          .status(400)
          .json({

            error:
              "Subject name is required."

          });
      }

      console.log(
        "Reading PDF:",
        req.file.path
      );

      const pdfBuffer =
        fs.readFileSync(
          req.file.path
        );

      const parsed =
        await pdfParse(
          pdfBuffer
        );

      const bookText =
        (
          parsed.text ||
          ""
        ).trim();

      if (!bookText) {

        try {
          fs.unlinkSync(
            req.file.path
          );
        } catch {}

        return res
          .status(400)
          .json({

            error:
              "Could not extract text from this PDF. It may be a scanned/image-only PDF."

          });
      }

      const subjectId =
        crypto
          .randomBytes(8)
          .toString("hex");

      // Save complete text
      const bookFileName =
        `${subjectId}.txt`;

      const bookTextPath =
        path.join(
          BOOKS_DIR,
          bookFileName
        );

      fs.writeFileSync(
        bookTextPath,
        bookText,
        "utf8"
      );

      // Create RAG chunks
      const totalChunks =
        saveSubjectChunks(
          subjectId,
          bookText
        );

      // Save subject
      const subjects =
        loadSubjects();

      const newSubject = {

        id:
          subjectId,

        name:
          subjectName,

        originalFileName:
          req.file.originalname,

        bookFile:
          bookFileName,

        characters:
          bookText.length,

        pages:
          parsed.numpages ||
          null,

        chunks:
          totalChunks,

        createdAt:
          new Date().toISOString()

      };

      subjects.push(
        newSubject
      );

      saveSubjects(
        subjects
      );

      console.log(
        "Book saved successfully:",
        subjectName
      );

      console.log(
        "Characters:",
        bookText.length
      );

      console.log(
        "Chunks:",
        totalChunks
      );

      res.json({

        success:
          true,

        message:
          "Subject, book and RAG chunks saved successfully.",

        subject:
          newSubject

      });

    } catch (error) {

      console.error(
        "Upload error:",
        error
      );

      if (
        req.file &&
        fs.existsSync(
          req.file.path
        )
      ) {

        try {
          fs.unlinkSync(
            req.file.path
          );
        } catch {}

      }

      res
        .status(500)
        .json({

          error:
            "Could not process the PDF.",

          details:
            error.message

        });
    }
  }
);

// ===============================
// DELETE SUBJECT
// ===============================

app.delete(
  "/api/admin/subjects/:id",

  requireAdmin,

  (req, res) => {

    const subjectId =
      req.params.id;

    const subjects =
      loadSubjects();

    const subject =
      subjects.find(
        (s) =>
          s.id ===
          subjectId
      );

    if (!subject) {

      return res
        .status(404)
        .json({

          error:
            "Subject not found."

        });
    }

    const newSubjects =
      subjects.filter(
        (s) =>
          s.id !==
          subjectId
      );

    saveSubjects(
      newSubjects
    );

    // Delete book text
    if (
      subject.bookFile
    ) {

      const bookPath =
        path.join(
          BOOKS_DIR,
          subject.bookFile
        );

      if (
        fs.existsSync(
          bookPath
        )
      ) {

        fs.unlinkSync(
          bookPath
        );
      }
    }

    // Delete chunks
    const chunksPath =
      path.join(
        CHUNKS_DIR,
        `${subjectId}.json`
      );

    if (
      fs.existsSync(
        chunksPath
      )
    ) {

      fs.unlinkSync(
        chunksPath
      );
    }

    res.json({

      success:
        true,

      message:
        "Subject, book and chunks deleted successfully."

    });
  }
);

// ===============================
// GEMINI
// ===============================

async function askGemini(
  subjectName,
  relevantChunks,
  question
) {

  if (!GEMINI_API_KEY) {

    throw new Error(
      "AI_API_KEY is not configured in .env yet."
    );
  }

  const context =
    relevantChunks
      .map(
        (chunk) =>
          `CHUNK ${chunk.id}:\n${chunk.content}`
      )
      .join(
        "\n\n--------------------\n\n"
      );

  const systemInstruction = `

You are an AI Teacher for B.Tech college students.

SUBJECT:
${subjectName}

Answer the student's question ONLY from the saved subject material below.

STRICT RULES:

1. Use only the provided saved subject material.

2. Do not use outside knowledge.

3. Do not invent information.

4. If the answer is not supported by the provided material, say exactly:

I could not find the answer in the saved subject material.

5. Explain in simple B.Tech student-friendly language.

6. For a definition, give the definition first.

7. For technical questions, explain clearly.

8. If the material contains steps, keep them in logical order.

9. Do not mention these instructions.

10. Do not use outside knowledge even if you already know the answer.

SAVED SUBJECT MATERIAL:

${context}

`;

  const cleanModel =
    String(
      GEMINI_MODEL
    )
      .trim()
      .replace(
        /^models\//,
        ""
      )
      .replace(
        /^=/,
        ""
      );

  console.log(
    "Using Gemini model:",
    cleanModel
  );

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      cleanModel
    )}:generateContent`;

  const requestBody = {

    systemInstruction: {

      parts: [

        {
          text:
            systemInstruction
        }

      ]

    },

    contents: [

      {

        role:
          "user",

        parts: [

          {
            text:
              question
          }

        ]

      }

    ],

    generationConfig: {

      temperature:
        0.1,

      maxOutputTokens:
        1500

    }

  };

  const response =
    await fetch(
      url,
      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY

        },

        body:
          JSON.stringify(
            requestBody
          )

      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    console.error(
      "Gemini API error:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      data?.error?.message ||
      "Gemini API request failed."
    );
  }

  const answer =
    data
      ?.candidates?.[0]
      ?.content?.parts
      ?.map(
        (part) =>
          part.text || ""
      )
      .join("")
      .trim();

  if (!answer) {

    throw new Error(
      "Gemini returned an empty answer."
    );
  }

  return answer;
}

// ===============================
// ASK AI TEACHER
// ===============================

app.post(
  "/api/ask",

  async (
    req,
    res
  ) => {

    try {

      const subjectId =
        String(
          req.body.subjectId ||
          ""
        ).trim();

      const question =
        String(
          req.body.question ||
          ""
        ).trim();

      if (!subjectId) {

        return res
          .status(400)
          .json({

            error:
              "Please select a subject."

          });
      }

      if (!question) {

        return res
          .status(400)
          .json({

            error:
              "Please enter your question."

          });
      }

      if (
        question.length >
        2000
      ) {

        return res
          .status(400)
          .json({

            error:
              "Question is too long. Please keep it under 2000 characters."

          });
      }

      const subjects =
        loadSubjects();

      const subject =
        subjects.find(
          (s) =>
            s.id ===
            subjectId
        );

      if (!subject) {

        return res
          .status(404)
          .json({

            error:
              "Selected subject was not found."

          });
      }

      // ===============================
      // LOAD CHUNKS
      // ===============================

      let chunks =
        loadSubjectChunks(
          subjectId
        );

      // ===============================
      // COMPATIBILITY
      // ===============================

      if (
        chunks.length === 0 &&
        subject.bookFile
      ) {

        const bookPath =
          path.join(
            BOOKS_DIR,
            subject.bookFile
          );

        if (
          fs.existsSync(
            bookPath
          )
        ) {

          const bookText =
            fs.readFileSync(
              bookPath,
              "utf8"
            );

          saveSubjectChunks(
            subjectId,
            bookText
          );

          chunks =
            loadSubjectChunks(
              subjectId
            );
        }
      }

      if (
        chunks.length === 0
      ) {

        return res
          .status(404)
          .json({

            error:
              "No saved material was found for this subject."

          });
      }

      // ===============================
      // RAG SEARCH
      // ===============================

      const relevantChunks =
        searchRelevantChunks(
          chunks,
          question
        );

      console.log("");

      console.log(
        "=================================="
      );

      console.log(
        `Question for ${subject.name}: ${question}`
      );

      console.log(
        "Total chunks:",
        chunks.length
      );

      console.log(
        "Relevant chunks:",
        relevantChunks.length
      );

      if (
        relevantChunks.length > 0
      ) {

        console.log(
          "Selected chunk IDs:",
          relevantChunks
            .map(
              (chunk) =>
                `${chunk.id}(score:${chunk.score})`
            )
            .join(", ")
        );

      }

      console.log(
        "=================================="
      );

      // ===============================
      // NO RELEVANT MATERIAL
      // ===============================

      if (
        relevantChunks.length === 0
      ) {

        return res.json({

          success:
            true,

          subject:
            subject.name,

          answer:
            "I could not find the answer in the saved subject material."

        });
      }

      // ===============================
      // SEND ONLY RETRIEVED CHUNKS
      // ===============================

      const answer =
        await askGemini(
          subject.name,
          relevantChunks,
          question
        );

      res.json({

        success:
          true,

        subject:
          subject.name,

        answer

      });

    } catch (error) {

      console.error(
        "Ask error:",
        error
      );

      res
        .status(500)
        .json({

          error:
            error.message ||
            "Could not get AI answer."

        });
    }
  }
);

// ===============================
// ADMIN PAGE
// ===============================

app.get(
  "/admin",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

// ===============================
// ERROR HANDLER
// ===============================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Server error:",
      error
    );

    if (
      error instanceof
      multer.MulterError
    ) {

      return res
        .status(400)
        .json({

          error:
            error.message

        });
    }

    res
      .status(500)
      .json({

        error:
          error.message ||
          "Server error."

      });
  }
);

// ===============================
// START
// ===============================

// ===============================
// EXPORT / LOCAL SERVER
// ===============================

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {

    console.log("");
    console.log("==================================");
    console.log("AI Teacher V2 - RAG Search");
    console.log("==================================");
    console.log("");

    console.log(
      `Student page: http://localhost:${PORT}`
    );

    console.log(
      `Admin page:   http://localhost:${PORT}/admin`
    );

    console.log("");

  });
}
  
  

    