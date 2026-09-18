require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");

const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

const PORT = process.env.PORT || 10000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "gemini-3.6-flash";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const allowedOrigins = [
  "https://aiteachers.in",
  "https://www.aiteachers.in",
  "https://ai-teacher.raki74718.workers.dev",
  "https://ai-teacher-krishna.netlify.app",
  "http://localhost:3000",
  "http://localhost:10000"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-admin-token"
    ]
  })
);

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb"
  })
);

if (!AI_API_KEY) {
  console.error("AI_API_KEY is missing.");
  process.exit(1);
}

if (!SUPABASE_URL) {
  console.error("SUPABASE_URL is missing.");
  process.exit(1);
}

if (!SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_SECRET_KEY is missing.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
);

const genAI = new GoogleGenerativeAI(AI_API_KEY);

const aiModel = genAI.getGenerativeModel({
  model: AI_MODEL
});

const PUBLIC_DIR = path.join(__dirname, "public");

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, {
    recursive: true
  });
}

app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

const CHUNK_SIZE = 2500;

const CHUNK_OVERLAP = 300;

const TOP_K_CHUNKS = 10;

const adminTokens = new Set();

const topicAliases = {
  avl: [
    "avl",
    "avl tree",
    "avl trees",
    "balance factor",
    "rotation",
    "rotations",
    "left rotation",
    "right rotation"
  ],

  bst: [
    "bst",
    "binary search tree",
    "binary search trees"
  ],

  stack: [
    "stack",
    "stacks",
    "push",
    "pop"
  ],

  queue: [
    "queue",
    "queues",
    "enqueue",
    "dequeue"
  ],

  "linked list": [
    "linked list",
    "linked lists",
    "singly linked",
    "doubly linked",
    "circular linked"
  ],

  tree: [
    "tree",
    "trees",
    "binary tree",
    "tree traversal"
  ],

  graph: [
    "graph",
    "graphs",
    "bfs",
    "dfs",
    "breadth first",
    "depth first"
  ],

  sorting: [
    "sorting",
    "bubble sort",
    "selection sort",
    "insertion sort",
    "merge sort",
    "quick sort",
    "heap sort"
  ],

  searching: [
    "searching",
    "linear search",
    "binary search"
  ]
};

const stopWords = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "what",
  "whats",
  "who",
  "why",
  "how",
  "when",
  "where",
  "which",
  "explain",
  "define",
  "give",
  "me",
  "of",
  "for",
  "to",
  "in",
  "on",
  "and",
  "or",
  "with",
  "about",
  "does",
  "do",
  "can",
  "please",
  "tell",
  "show"
]);

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(text) {
  return cleanText(text).toLowerCase();
}

function tokenize(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(function (word) {
      return !stopWords.has(word);
    })
    .slice(0, 60);
}

function detectTopics(question) {
  const q = normalizeText(question);

  const topics = [];

  for (const entry of Object.entries(topicAliases)) {
    const topic = entry[0];
    const aliases = entry[1];

    for (const alias of aliases) {
      if (q.includes(alias)) {
        topics.push(topic);
        break;
      }
    }
  }

  return topics;
}

function makeChunks(text) {
  const source = cleanText(text);

  const chunks = [];

  let start = 0;

  while (start < source.length) {
    const end = Math.min(
      start + CHUNK_SIZE,
      source.length
    );

    const chunkText = source
      .slice(start, end)
      .trim();

    if (chunkText) {
      chunks.push({
        index: chunks.length,
        text: chunkText
      });
    }

    if (end >= source.length) {
      break;
    }

    start = Math.max(
      end - CHUNK_OVERLAP,
      start + 1
    );
  }

  return chunks;
}

function scoreChunk(question, chunk) {
  const q = normalizeText(question);

  const text = normalizeText(chunk.text);

  const keywords = tokenize(question);

  const topics = detectTopics(question);

  let score = 0;

  for (const word of keywords) {
    if (text.includes(word)) {
      if (word.length >= 5) {
        score += 3;
      } else {
        score += 1;
      }
    }
  }

  for (const topic of topics) {
    const aliases = topicAliases[topic] || [];

    for (const alias of aliases) {
      if (text.includes(alias)) {
        score += 5;
      }
    }
  }

  if (q.length > 8 && text.includes(q)) {
    score += 20;
  }

  return score;
}

function rankChunks(question, chunks) {
  return chunks
    .map(function (chunk) {
      return {
        ...chunk,
        score: scoreChunk(question, chunk)
      };
    })
    .filter(function (item) {
      return item.score > 0;
    })
    .sort(function (a, b) {
      return b.score - a.score;
    })
    .slice(0, TOP_K_CHUNKS);
}

async function uploadTextFile(storagePath, text) {
  const buffer = Buffer.from(
    text,
    "utf8"
  );

  const result = await supabase
    .storage
    .from("books")
    .upload(
      storagePath,
      buffer,
      {
        contentType: "text/plain",
        upsert: true
      }
    );

  if (result.error) {
    throw result.error;
  }
}

async function uploadJsonFile(storagePath, data) {
  const buffer = Buffer.from(
    JSON.stringify(data),
    "utf8"
  );

  const result = await supabase
    .storage
    .from("books")
    .upload(
      storagePath,
      buffer,
      {
        contentType: "application/json",
        upsert: true
      }
    );

  if (result.error) {
    throw result.error;
  }
}

async function downloadTextFile(storagePath) {
  const result = await supabase
    .storage
    .from("books")
    .download(storagePath);

  if (result.error) {
    throw result.error;
  }

  return await result.data.text();
}

async function downloadJsonFile(storagePath) {
  const text = await downloadTextFile(
    storagePath
  );

  return JSON.parse(text);
}

async function loadSubjectChunks(subject) {
  if (subject.chunks_path) {
    try {
      const chunks = await downloadJsonFile(
        subject.chunks_path
      );

      if (Array.isArray(chunks)) {
        return chunks;
      }
    } catch (error) {
      console.warn(
        "Could not load chunks_path:",
        error.message
      );
    }
  }

  if (subject.text_path) {
    try {
      const text = await downloadTextFile(
        subject.text_path
      );

      return makeChunks(text);
    } catch (error) {
      console.warn(
        "Could not load text_path:",
        error.message
      );
    }
  }

  if (subject.book_file) {
    try {
      const text = await downloadTextFile(
        subject.book_file
      );

      return makeChunks(text);
    } catch (error) {
      console.warn(
        "Could not load book_file:",
        error.message
      );
    }
  }

  throw new Error(
    "Book content is not available in storage for this subject."
  );
}

function isAdmin(req) {
  const token =
    req.headers["x-admin-token"];

  return Boolean(
    token &&
    adminTokens.has(token)
  );
}

app.get("/", function (req, res) {
  res.sendFile(
    path.join(
      PUBLIC_DIR,
      "index.html"
    )
  );
});

app.get("/admin", function (req, res) {
  const adminFile = path.join(
    PUBLIC_DIR,
    "admin.html"
  );

  if (fs.existsSync(adminFile)) {
    return res.sendFile(adminFile);
  }

  return res
    .status(404)
    .send("Admin page not found.");
});

app.get(
  "/api/subjects",
  async function (req, res) {
    try {
      const result = await supabase
        .from("subjects")
        .select(
          "id,name,pages,characters,created_at"
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        );

      if (result.error) {
        throw result.error;
      }

      return res.json(
        result.data || []
      );
    } catch (error) {
      console.error(
        "GET /api/subjects:",
        error
      );

      return res.status(500).json({
        error:
          "Could not load subjects."
      });
    }
  }
);

app.post(
  "/api/admin/login",
  async function (req, res) {
    try {
      const password = String(
        req.body &&
        req.body.password
          ? req.body.password
          : ""
      );

      if (
        !ADMIN_PASSWORD ||
        password !== ADMIN_PASSWORD
      ) {
        return res.status(401).json({
          error:
            "Invalid admin password."
        });
      }

      const token =
        crypto.randomBytes(32)
          .toString("hex");

      adminTokens.add(token);

      return res.json({
        success: true,
        token: token
      });
    } catch (error) {
      console.error(
        "Admin login error:",
        error
      );

      return res.status(500).json({
        error:
          "Login failed."
      });
    }
  }
);

app.get(
  "/api/admin/subjects",
  async function (req, res) {
    if (!isAdmin(req)) {
      return res.status(401).json({
        error:
          "Unauthorized."
      });
    }

    try {
      const result = await supabase
        .from("subjects")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        );

      if (result.error) {
        throw result.error;
      }

      return res.json(
        result.data || []
      );
    } catch (error) {
      console.error(
        "GET /api/admin/subjects:",
        error
      );

      return res.status(500).json({
        error:
          "Could not load admin subjects."
      });
    }
  }
);

app.post(
  "/api/admin/upload",
  upload.single("file"),
  async function (req, res) {
    if (!isAdmin(req)) {
      return res.status(401).json({
        error:
          "Unauthorized."
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            "PDF file is required."
        });
      }

      const originalName =
        req.file.originalname ||
        "book.pdf";

      const extension =
        path
          .extname(originalName)
          .toLowerCase();

      if (
        extension !== ".pdf" &&
        req.file.mimetype !==
          "application/pdf"
      ) {
        return res.status(400).json({
          error:
            "Only PDF files are supported."
        });
      }

      const requestedName =
        req.body &&
        req.body.name
          ? String(req.body.name).trim()
          : "";

      const subjectName =
        requestedName ||
        path.basename(
          originalName,
          extension
        ) ||
        "New Subject";

      const subjectId =
        crypto
          .randomBytes(8)
          .toString("hex");

      console.log(
        "Extracting PDF:",
        originalName
      );

      const parsed =
        await pdfParse(
          req.file.buffer
        );

      const text = cleanText(
        parsed.text
      );

      if (!text) {
        return res.status(400).json({
          error:
            "No readable text was found in the PDF."
        });
      }

      const chunks =
        makeChunks(text);

      const textPath =
        "books/" +
        subjectId +
        "/book.txt";

      const chunksPath =
        "books/" +
        subjectId +
        "/chunks.json";

      await uploadTextFile(
        textPath,
        text
      );

      await uploadJsonFile(
        chunksPath,
        chunks
      );

      const result =
        await supabase
          .from("subjects")
          .insert({
            id: subjectId,
            name: subjectName,
            original_file_name:
              originalName,
            book_file: null,
            pages:
              parsed.numpages || null,
            characters:
              text.length,
            chunks:
              chunks.length,
            chunks_path:
              chunksPath,
            text_path:
              textPath
          })
          .select()
          .single();

      if (result.error) {
        throw result.error;
      }

      console.log(
        "Upload complete:",
        subjectName
      );

      console.log(
        "Pages:",
        parsed.numpages
      );

      console.log(
        "Chunks:",
        chunks.length
      );

      return res.json({
        success: true,
        subject: result.data
      });
    } catch (error) {
      console.error(
        "PDF upload error:",
        error
      );

      return res.status(500).json({
        error:
          error.message ||
          "PDF upload failed."
      });
    }
  }
);

app.delete(
  "/api/admin/subjects/:id",
  async function (req, res) {
    if (!isAdmin(req)) {
      return res.status(401).json({
        error:
          "Unauthorized."
      });
    }

    try {
      const id =
        String(req.params.id);

      const result =
        await supabase
          .from("subjects")
          .select("*")
          .eq("id", id)
          .maybeSingle();

      if (result.error) {
        throw result.error;
      }

      const subject =
        result.data;

      if (!subject) {
        return res.status(404).json({
          error:
            "Subject not found."
        });
      }

      const paths = [];

      if (subject.text_path) {
        paths.push(
          subject.text_path
        );
      }

      if (subject.chunks_path) {
        paths.push(
          subject.chunks_path
        );
      }

      if (subject.book_file) {
        paths.push(
          subject.book_file
        );
      }

      if (paths.length > 0) {
        const removeResult =
          await supabase
            .storage
            .from("books")
            .remove(paths);

        if (removeResult.error) {
          console.warn(
            "Storage delete warning:",
            removeResult.error.message
          );
        }
      }

      const deleteResult =
        await supabase
          .from("subjects")
          .delete()
          .eq("id", id);

      if (deleteResult.error) {
        throw deleteResult.error;
      }

      return res.json({
        success: true
      });
    } catch (error) {
      console.error(
        "Delete subject error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not delete subject."
      });
    }
  }
);

app.post(
  "/api/ask",
  async function (req, res) {
    try {
      const question =
        req.body &&
        req.body.question
          ? String(
              req.body.question
            ).trim()
          : "";

      const subjectId =
        req.body &&
        req.body.subjectId
          ? String(
              req.body.subjectId
            ).trim()
          : "";

      if (!question) {
        return res.status(400).json({
          error:
            "Question is required."
        });
      }

      if (!subjectId) {
        return res.status(400).json({
          error:
            "Subject is required."
        });
      }

      const subjectResult =
        await supabase
          .from("subjects")
          .select("*")
          .eq("id", subjectId)
          .maybeSingle();

      if (subjectResult.error) {
        throw subjectResult.error;
      }

      const subject =
        subjectResult.data;

      if (!subject) {
        return res.status(404).json({
          error:
            "Subject not found."
        });
      }

      console.log(
        "================================================="
      );

      console.log(
        "SEARCH CHUNKS"
      );

      console.log(
        "Question:",
        question
      );

      const topics =
        detectTopics(question);

      const keywords =
        tokenize(question);

      console.log(
        "Detected topics:",
        topics
      );

      console.log(
        "Question keywords:",
        keywords
      );

      const chunks =
        await loadSubjectChunks(
          subject
        );

      const selected =
        rankChunks(
          question,
          chunks
        );

      console.log(
        "Top matches:",
        selected
          .slice(0, 5)
          .map(function (item) {
            return (
              String(item.index) +
              "(score:" +
              String(item.score) +
              ")"
            );
          })
          .join(", ")
      );

      if (selected.length === 0) {
        return res.json({
          answer:
            "I could not find enough relevant information in the uploaded textbook for this question.",
          source:
            subject.name,
          pages: []
        });
      }

      const context =
        selected
          .map(function (item) {
            return (
              "CHUNK " +
              String(item.index) +
              "\n" +
              item.text
            );
          })
          .join("\n\n");

      const prompt =
        "You are an AI Teacher.\n\n" +

        "Answer the student's question using ONLY the textbook context below.\n\n" +

        "Rules:\n" +
        "1. Do not invent facts that are not supported by the context.\n" +
        "2. Explain clearly for a student.\n" +
        "3. If the context does not contain the answer, say that the uploaded textbook does not provide enough information.\n" +
        "4. Give a direct answer first.\n" +
        "5. Use short headings or bullet points when useful.\n" +
        "6. Do not mention internal chunk numbers.\n" +
        "7. Do not pretend to know information that is missing.\n\n" +

        "Subject:\n" +
        subject.name +
        "\n\n" +

        "Student question:\n" +
        question +
        "\n\n" +

        "Textbook context:\n" +
        context;

      const result =
        await aiModel.generateContent(
          prompt
        );

      const response =
        result.response;

      const answer =
        response.text();

      return res.json({
        answer: answer,
        source:
          subject.name,
        pages: []
      });
    } catch (error) {
      console.error(
        "POST /api/ask error:",
        error
      );

      return res.status(500).json({
        error:
          error.message ||
          "AI Teacher could not answer the question."
      });
    }
  }
);

app.use(
  function (error, req, res, next) {
    console.error(
      "Server error:",
      error
    );

    if (
      error instanceof
      multer.MulterError
    ) {
      return res.status(400).json({
        error:
          error.message
      });
    }

    return res.status(500).json({
      error:
        error.message ||
        "Internal server error."
    });
  }
);

app.listen(
  PORT,
  function () {
    console.log(
      "=============================================="
    );

    console.log(
      "AI Teacher backend started"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Gemini model:",
      AI_MODEL
    );

    console.log(
      "Supabase:",
      SUPABASE_URL
        ? "loaded"
        : "missing"
    );

    console.log(
      "=============================================="
    );
  }
);