```js
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

/* =========================================================
   CORS
========================================================= */

const allowedOrigins = [
  "https://aiteachers.in",
  "https://www.aiteachers.in",
  "https://ai-teacher.raki74718.workers.dev",
  "http://localhost:3000",
  "http://localhost:10000"
];

app.use(
  cors({
    origin: function (origin, callback) {

      // Allow requests without an Origin header
      // such as curl/server-to-server requests.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log(
        "CORS blocked origin:",
        origin
      );

      return callback(
        new Error("Not allowed by CORS")
      );
    },

    methods: [
      "GET",
      "POST",
      "DELETE",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-admin-token"
    ]
  })
);

/* =========================================================
   EXPRESS
========================================================= */

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


/* =========================================================
   ENVIRONMENT
========================================================= */

const PORT =
  process.env.PORT || 3000;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;

const AI_API_KEY =
  process.env.AI_API_KEY;

const AI_MODEL =
  process.env.AI_MODEL ||
  "gemini-3.6-flash";

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;


console.log(
  "ADMIN_PASSWORD loaded:",
  ADMIN_PASSWORD ? "YES" : "NO"
);

console.log(
  "GEMINI_API_KEY loaded:",
  AI_API_KEY ? "YES" : "NO"
);

console.log(
  "GEMINI_MODEL:",
  AI_MODEL
);

console.log(
  "SUPABASE_URL loaded:",
  SUPABASE_URL ? "YES" : "NO"
);

console.log(
  "SUPABASE_SECRET_KEY loaded:",
  SUPABASE_SECRET_KEY ? "YES" : "NO"
);


/* =========================================================
   SUPABASE
========================================================= */

if (
  !SUPABASE_URL ||
  !SUPABASE_SECRET_KEY
) {

  console.error(
    "Supabase environment variables are missing."
  );

}

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
  );


/* =========================================================
   GEMINI
========================================================= */

if (!AI_API_KEY) {

  console.error(
    "AI_API_KEY is missing."
  );

}

const genAI =
  new GoogleGenerativeAI(
    AI_API_KEY
  );


/* =========================================================
   PUBLIC FOLDER
========================================================= */

const publicPath =
  path.join(
    __dirname,
    "public"
  );

app.use(
  express.static(
    publicPath
  )
);


/* =========================================================
   TEMP FOLDER
========================================================= */

const tempPath =
  path.join(
    __dirname,
    "tmp"
  );

if (
  !fs.existsSync(
    tempPath
  )
) {

  fs.mkdirSync(
    tempPath,
    {
      recursive: true
    }
  );

}


/* =========================================================
   ADMIN TOKENS
========================================================= */

const adminTokens =
  new Set();


/* =========================================================
   MULTER
   100 MB PDF LIMIT
========================================================= */

const upload =
  multer({

    storage:
      multer.diskStorage({

        destination:
          function (
            req,
            file,
            cb
          ) {

            cb(
              null,
              tempPath
            );

          },

        filename:
          function (
            req,
            file,
            cb
          ) {

            const unique =
              Date.now() +
              "-" +
              crypto
                .randomBytes(6)
                .toString("hex");

            cb(
              null,
              unique +
              ".pdf"
            );

          }

      }),

    limits: {

      fileSize:
        100 *
        1024 *
        1024

    },

    fileFilter:
      function (
        req,
        file,
        cb
      ) {

        const isPdf =
          file.mimetype ===
          "application/pdf";

        if (!isPdf) {

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


/* =========================================================
   TEXT CLEANING
========================================================= */

function cleanText(text) {

  return String(
    text || ""
  )

    .replace(
      /\r/g,
      " "
    )

    .replace(
      /[ \t]+/g,
      " "
    )

    .replace(
      /\n{3,}/g,
      "\n\n"
    )

    .trim();

}


/* =========================================================
   CREATE CHUNKS
========================================================= */

const CHUNK_SIZE =
  2500;

const CHUNK_OVERLAP =
  300;

const TOP_K_CHUNKS =
  10;


function createChunks(text) {

  const cleaned =
    cleanText(text);

  const chunks = [];

  let start = 0;

  let id = 1;


  while (
    start <
    cleaned.length
  ) {

    let end =
      start +
      CHUNK_SIZE;


    if (
      end <
      cleaned.length
    ) {

      const paragraphBreak =
        cleaned.lastIndexOf(
          "\n",
          end
        );

      const sentenceBreak =
        cleaned.lastIndexOf(
          ". ",
          end
        );


      if (
        paragraphBreak >
        start + 1000
      ) {

        end =
          paragraphBreak;

      } else if (
        sentenceBreak >
        start + 1000
      ) {

        end =
          sentenceBreak + 1;

      }

    }


    const chunkText =
      cleaned
        .slice(
          start,
          end
        )
        .trim();


    if (chunkText) {

      chunks.push({

        id,

        text:
          chunkText

      });

      id++;

    }


    const nextStart =
      end -
      CHUNK_OVERLAP;


    if (
      nextStart <= start
    ) {

      start =
        end;

    } else {

      start =
        nextStart;

    }

  }


  return chunks;

}


/* =========================================================
   NORMALIZE QUESTION
========================================================= */

function normalizeQuestion(text) {

  return String(
    text || ""
  )
    .toLowerCase()
    .replace(
      /[^\w\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


/* =========================================================
   SEARCH CHUNKS
========================================================= */

function searchChunks(
  question,
  chunks
) {

  if (
    !Array.isArray(chunks) ||
    chunks.length === 0
  ) {

    return [];

  }


  const q =
    normalizeQuestion(
      question
    );


  const topicAliases = {

    avl: [

      "avl",
      "avl tree",
      "avl trees",
      "balanced binary search tree",
      "height balanced tree",
      "height balanced binary search tree",
      "rotation",
      "rotations",
      "ll rotation",
      "rr rotation",
      "lr rotation",
      "rl rotation"

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
      "pop",
      "peek",
      "lifo"

    ],

    queue: [

      "queue",
      "queues",
      "enqueue",
      "dequeue",
      "fifo"

    ],

    linkedlist: [

      "linked list",
      "linked lists",
      "singly linked list",
      "doubly linked list",
      "circular linked list"

    ],

    tree: [

      "tree",
      "trees",
      "binary tree",
      "binary trees"

    ],

    graph: [

      "graph",
      "graphs",
      "bfs",
      "dfs"

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


  const stopWords =
    new Set([

      "what",
      "is",
      "are",
      "the",
      "a",
      "an",
      "and",
      "or",
      "of",
      "to",
      "for",
      "in",
      "on",
      "with",
      "from",
      "explain",
      "write",
      "describe",
      "define",
      "give",
      "me",
      "about",
      "its",
      "their",
      "this",
      "that",
      "how",
      "does",
      "do",
      "marks",
      "mark",
      "please",
      "show",
      "tell",
      "discuss",
      "list",
      "mention",
      "types",
      "type",
      "example",
      "examples",
      "using",
      "used"

    ]);


  const words =
    q
      .split(/\s+/)
      .filter(
        word =>
          word.length >= 2
      );


  const keywords =
    words.filter(
      word =>
        !stopWords.has(word)
    );


  const topics = [];


  for (
    const [topic, aliases]
    of Object.entries(
      topicAliases
    )
  ) {

    for (
      const alias
      of aliases
    ) {

      if (
        q.includes(alias)
      ) {

        topics.push(
          topic
        );

        break;

      }

    }

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

  console.log(
    "Detected topics:",
    topics
  );

  console.log(
    "Question keywords:",
    keywords
  );

  console.log(
    "Total chunks:",
    chunks.length
  );


  const scored =
    chunks.map(
      (
        chunk,
        index
      ) => {

        const text =
          normalizeQuestion(
            chunk.text ||
            chunk.content ||
            ""
          );


        let score = 0;


        for (
          const keyword
          of keywords
        ) {

          if (
            text.includes(
              keyword
            )
          ) {

            score += 2;

          }

        }


        if (
          q.length >= 4 &&
          text.includes(q)
        ) {

          score += 10;

        }


        for (
          const topic
          of topics
        ) {

          const aliases =
            topicAliases[
              topic
            ] || [];


          for (
            const alias
            of aliases
          ) {

            if (
              text.includes(alias)
            ) {

              score += 5;

            }

          }

        }


        if (
          topics.includes("avl")
        ) {

          if (
            text.includes("avl")
          ) {

            score += 20;

          }

          if (
            text.includes("rotation")
          ) {

            score += 10;

          }

          if (
            text.includes("balance")
          ) {

            score += 6;

          }

          if (
            text.includes("height")
          ) {

            score += 5;

          }

          if (
            text.includes(
              "left rotation"
            )
          ) {

            score += 8;

          }

          if (
            text.includes(
              "right rotation"
            )
          ) {

            score += 8;

          }

        }


        if (
          topics.includes("stack")
        ) {

          if (
            text.includes("stack")
          ) {

            score += 15;

          }

          if (
            text.includes("push")
          ) {

            score += 6;

          }

          if (
            text.includes("pop")
          ) {

            score += 6;

          }

          if (
            text.includes("peek")
          ) {

            score += 5;

          }

          if (
            text.includes("lifo")
          ) {

            score += 5;

          }

        }


        if (
          topics.includes("bst")
        ) {

          if (
            text.includes("bst")
          ) {

            score += 15;

          }

          if (
            text.includes(
              "binary search tree"
            )
          ) {

            score += 15;

          }

        }


        if (
          topics.includes("queue")
        ) {

          if (
            text.includes("queue")
          ) {

            score += 15;

          }

          if (
            text.includes("enqueue")
          ) {

            score += 6;

          }

          if (
            text.includes("dequeue")
          ) {

            score += 6;

          }

          if (
            text.includes("fifo")
          ) {

            score += 5;

          }

        }


        return {

          chunk,
          index,
          score

        };

      }
    );


  scored.sort(
    (a, b) =>
      b.score -
      a.score
  );


  let selected =
    scored
      .filter(
        item =>
          item.score > 0
      )
      .slice(
        0,
        TOP_K_CHUNKS
      );


  if (
    selected.length === 0 &&
    topics.length > 0
  ) {

    console.log(
      "No normal matches."
    );

    console.log(
      "Trying topic fallback..."
    );


    const aliases = [];


    for (
      const topic
      of topics
    ) {

      aliases.push(
        ...(
          topicAliases[
            topic
          ] || []
        )
      );

    }


    selected =
      chunks
        .map(
          (
            chunk,
            index
          ) => {

            const text =
              normalizeQuestion(
                chunk.text ||
                chunk.content ||
                ""
              );


            let score = 0;


            for (
              const alias
              of aliases
            ) {

              if (
                text.includes(alias)
              ) {

                score++;

              }

            }


            return {

              chunk,
              index,
              score

            };

          }
        )
        .filter(
          item =>
            item.score > 0
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(
          0,
          TOP_K_CHUNKS
        );

  }


  const finalIndexes =
    new Set();


  for (
    const item
    of selected
  ) {

    finalIndexes.add(
      item.index
    );


    if (
      item.index > 0
    ) {

      finalIndexes.add(
        item.index - 1
      );

    }


    if (
      item.index <
      chunks.length - 1
    ) {

      finalIndexes.add(
        item.index + 1
      );

    }

  }


  const results =
    Array.from(
      finalIndexes
    )
      .sort(
        (a, b) =>
          a - b
      )
      .map(
        index =>
          chunks[index]
      )
      .slice(
        0,
        TOP_K_CHUNKS + 4
      );


  console.log(
    "Relevant chunks:",
    results.length
  );


  if (
    selected.length > 0
  ) {

    console.log(
      "Top matches:",
      selected
        .slice(0, 5)
        .map(
          item =>
            `${item.index}(score:${item.score})`
        )
        .join(", ")
    );

  }


  console.log(
    "================================================="
  );


  return results;

}


/* =========================================================
   SUPABASE STORAGE
========================================================= */

const STORAGE_BUCKET =
  "books";


async function uploadTextFile(
  filePath,
  content
) {

  const buffer =
    Buffer.from(
      content,
      "utf8"
    );


  const { error } =
    await supabase
      .storage
      .from(
        STORAGE_BUCKET
      )
      .upload(
        filePath,
        buffer,
        {
          contentType:
            "text/plain",
          upsert:
            true
        }
      );


  if (error) {
    throw error;
  }

}


async function uploadJsonFile(
  filePath,
  data
) {

  const buffer =
    Buffer.from(
      JSON.stringify(data),
      "utf8"
    );


  const { error } =
    await supabase
      .storage
      .from(
        STORAGE_BUCKET
      )
      .upload(
        filePath,
        buffer,
        {
          contentType:
            "application/json",
          upsert:
            true
        }
      );


  if (error) {
    throw error;
  }

}


async function downloadJsonFile(
  filePath
) {

  const { data, error } =
    await supabase
      .storage
      .from(
        STORAGE_BUCKET
      )
      .download(
        filePath
      );


  if (error) {
    throw error;
  }


  const text =
    await data.text();


  return JSON.parse(
    text
  );

}


/* =========================================================
   PDF EXTRACTION
========================================================= */

async function extractPdfText(
  filePath
) {

  const buffer =
    fs.readFileSync(
      filePath
    );


  console.log(
    "PDF buffer loaded."
  );


  const result =
    await pdfParse(
      buffer
    );


  const text =
    cleanText(
      result.text
    );


  console.log(
    "Pages:",
    result.numpages
  );

  console.log(
    "Characters:",
    text.length
  );


  return {

    text,

    pages:
      result.numpages

  };

}


/* =========================================================
   ADMIN AUTH
========================================================= */

function adminAuth(
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
    !adminTokens.has(token)
  ) {

    return res
      .status(401)
      .json({
        error:
          "Unauthorized"
      });

  }


  next();

}


/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/admin/login",
  (req, res) => {

    const password =
      req.body &&
      req.body.password;


    if (
      !ADMIN_PASSWORD ||
      password !==
        ADMIN_PASSWORD
    ) {

      return res
        .status(401)
        .json({
          error:
            "Invalid password"
        });

    }


    const token =
      crypto
        .randomBytes(32)
        .toString("hex");


    adminTokens.add(
      token
    );


    res.json({
      token
    });

  }
);


/* =========================================================
   GET SUBJECTS
========================================================= */

app.get(
  "/api/subjects",
  async (
    req,
    res
  ) => {

    try {

      const {
        data,
        error
      } =
        await supabase
          .from("subjects")
          .select(
            "id,name,pages,characters"
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );


      if (error) {
        throw error;
      }


      res.json(
        data || []
      );


    } catch (error) {

      console.error(
        "SUBJECTS ERROR:",
        error
      );


      res
        .status(500)
        .json({
          error:
            "Could not load subjects."
        });

    }

  }
);


/* =========================================================
   ADMIN SUBJECTS
========================================================= */

app.get(
  "/api/admin/subjects",
  adminAuth,
  async (
    req,
    res
  ) => {

    try {

      const {
        data,
        error
      } =
        await supabase
          .from("subjects")
          .select("*")
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );


      if (error) {
        throw error;
      }


      res.json(
        data || []
      );


    } catch (error) {

      console.error(
        "ADMIN SUBJECT ERROR:",
        error
      );


      res
        .status(500)
        .json({
          error:
            "Could not load subjects."
        });

    }

  }
);


/* =========================================================
   UPLOAD PDF
========================================================= */

app.post(
  "/api/admin/upload",
  adminAuth,
  upload.single("book"),
  async (
    req,
    res
  ) => {

    let uploadedFile =
      null;


    try {

      if (!req.file) {

        return res
          .status(400)
          .json({
            error:
              "Please upload a PDF file."
          });

      }


      uploadedFile =
        req.file.path;


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
        "=================================="
      );

      console.log(
        "PDF UPLOAD STARTED"
      );

      console.log(
        "File:",
        req.file.originalname
      );

      console.log(
        "Size:",
        req.file.size,
        "bytes"
      );

      console.log(
        "=================================="
      );


      const extracted =
        await extractPdfText(
          uploadedFile
        );


      if (
        !extracted.text ||
        extracted.text.length < 20
      ) {

        return res
          .status(400)
          .json({
            error:
              "Could not extract readable text from this PDF."
          });

      }


      console.log(
        "Creating chunks..."
      );


      const chunks =
        createChunks(
          extracted.text
        );


      console.log(
        "Chunks:",
        chunks.length
      );


      if (
        chunks.length === 0
      ) {

        return res
          .status(400)
          .json({
            error:
              "No readable content found in PDF."
          });

      }


      const subjectId =
        crypto
          .randomBytes(8)
          .toString("hex");


      const textPath =
        `books/${subjectId}/book.txt`;

      const chunksPath =
        `books/${subjectId}/chunks.json`;


      console.log(
        "Uploading book text..."
      );


      await uploadTextFile(
        textPath,
        extracted.text
      );


      console.log(
        "Uploading chunks..."
      );


      await uploadJsonFile(
        chunksPath,
        chunks
      );


      const {
        error: subjectError
      } =
        await supabase
          .from("subjects")
          .insert({

            id:
              subjectId,

            name:
              subjectName,

            pages:
              extracted.pages,

            characters:
              extracted.text.length,

            text_path:
              textPath,

            chunks_path:
              chunksPath

          });


      if (
        subjectError
      ) {

        throw subjectError;

      }


      console.log(
        "Subject saved:",
        subjectId
      );


      res.json({

        success:
          true,

        message:
          "PDF processed successfully.",

        subject: {

          id:
            subjectId,

          name:
            subjectName,

          pages:
            extracted.pages,

          characters:
            extracted.text.length,

          chunks:
            chunks.length

        }

      });


    } catch (error) {

      console.error(
        "BOOK UPLOAD ERROR:",
        error
      );


      res
        .status(500)
        .json({

          error:
            error.message ||
            "Could not process the PDF."

        });


    } finally {

      if (
        uploadedFile &&
        fs.existsSync(
          uploadedFile
        )
      ) {

        try {

          fs.unlinkSync(
            uploadedFile
          );

        } catch (
          deleteError
        ) {

          console.error(
            "Temp PDF delete error:",
            deleteError
          );

        }

      }

    }

  }
);


/* =========================================================
   ASK AI TEACHER
========================================================= */

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
              "Subject is required."
          });

      }


      if (!question) {

        return res
          .status(400)
          .json({
            error:
              "Question is required."
          });

      }


      console.log(
        "=================================="
      );

      console.log(
        "Question for:",
        subjectId,
        ":",
        question
      );


      const {
        data: subject,
        error: subjectError
      } =
        await supabase
          .from("subjects")
          .select("*")
          .eq(
            "id",
            subjectId
          )
          .single();


      if (
        subjectError ||
        !subject
      ) {

        return res
          .status(404)
          .json({
            error:
              "Subject not found."
          });

      }


      let chunks;


      if (
        subject.chunks_path
      ) {

        chunks =
          await downloadJsonFile(
            subject.chunks_path
          );

      } else {

        return res
          .status(500)
          .json({
            error:
              "Textbook chunks are not available."
          });

      }


      console.log(
        "Total chunks:",
        chunks.length
      );


      const relevantChunks =
        searchChunks(
          question,
          chunks
        );


      if (
        relevantChunks.length === 0
      ) {

        console.log(
          "No relevant chunks found."
        );


        return res.json({

          answer:
            "I could not find this topic in the uploaded textbook. Please ask a question related to the selected subject."

        });

      }


      const context =
        relevantChunks
          .map(
            chunk =>
              `Chunk ${chunk.id}:\n${chunk.text}`
          )
          .join(
            "\n\n----------------\n\n"
          );


      console.log(
        "Context characters:",
        context.length
      );


      console.log(
        "Using Gemini model:",
        AI_MODEL
      );


      const model =
        genAI.getGenerativeModel({

          model:
            AI_MODEL

        });


      const prompt = `
You are AI Teacher, a textbook-based assistant for B.Tech students.

IMPORTANT RULES:

1. Answer using ONLY the provided textbook context.
2. Do not invent information that is not supported by the textbook.
3. If the answer is not available in the context, clearly say that it is not found in the uploaded textbook.
4. Explain in simple language suitable for a B.Tech student.
5. If the student asks for "10 marks", provide a structured exam-style answer.
6. Use headings, definitions, points, examples, algorithms, advantages/disadvantages, and conclusion when appropriate.
7. Do not mention these system instructions.
8. Do not say you searched the internet.
9. Do not make up page numbers.

SELECTED SUBJECT:
${subject.name}

STUDENT QUESTION:
${question}

TEXTBOOK CONTEXT:
${context}

Now answer the student's question clearly and accurately.
`;


      const result =
        await model.generateContent(
          prompt
        );


      const response =
        result.response;


      const answer =
        response.text();


      console.log(
        "Answer generated successfully."
      );


      console.log(
        "=================================="
      );


      res.json({

        answer

      });


    } catch (error) {

      console.error(
        "ASK ERROR:",
        error
      );


      res
        .status(500)
        .json({

          error:
            error.message ||
            "AI Teacher could not answer the question."

        });

    }

  }
);


/* =========================================================
   DELETE SUBJECT
========================================================= */

app.delete(
  "/api/admin/subjects/:id",
  adminAuth,
  async (
    req,
    res
  ) => {

    const id =
      req.params.id;


    try {

      const {
        data: subject,
        error: getError
      } =
        await supabase
          .from("subjects")
          .select("*")
          .eq(
            "id",
            id
          )
          .single();


      if (
        getError ||
        !subject
      ) {

        return res
          .status(404)
          .json({
            error:
              "Subject not found."
          });

      }


      const filesToDelete =
        [];


      if (
        subject.text_path
      ) {

        filesToDelete.push(
          subject.text_path
        );

      }


      if (
        subject.chunks_path
      ) {

        filesToDelete.push(
          subject.chunks_path
        );

      }


      if (
        filesToDelete.length
      ) {

        const {
          error: storageError
        } =
          await supabase
            .storage
            .from(
              STORAGE_BUCKET
            )
            .remove(
              filesToDelete
            );


        if (
          storageError
        ) {

          console.error(
            "Storage delete error:",
            storageError
          );

        }

      }


      const {
        error: deleteError
      } =
        await supabase
          .from("subjects")
          .delete()
          .eq(
            "id",
            id
          );


      if (
        deleteError
      ) {

        throw deleteError;

      }


      res.json({

        success:
          true,

        message:
          "Subject deleted successfully."

      });


    } catch (error) {

      console.error(
        "DELETE SUBJECT ERROR:",
        error
      );


      res
        .status(500)
        .json({

          error:
            error.message ||
            "Could not delete subject."

        });

    }

  }
);


/* =========================================================
   MULTER / SERVER ERROR HANDLER
========================================================= */

app.use(
  function (
    error,
    req,
    res,
    next
  ) {

    if (
      error instanceof
      multer.MulterError
    ) {

      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {

        return res
          .status(400)
          .json({

            error:
              "File is larger than the 100 MB limit."

          });

      }


      return res
        .status(400)
        .json({

          error:
            error.message

        });

    }


    if (error) {

      console.error(
        "SERVER ERROR:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message ||
            "Server error."

        });

    }


    next();

  }
);


/* =========================================================
   PAGES
========================================================= */

app.get(
  "/",
  (
    req,
    res
  ) => {

    res.sendFile(
      path.join(
        publicPath,
        "index.html"
      )
    );

  }
);


app.get(
  "/admin",
  (
    req,
    res
  ) => {

    res.sendFile(
      path.join(
        publicPath,
        "admin.html"
      )
    );

  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log("");

    console.log(
      "=================================="
    );

    console.log(
      "AI Teacher V2 - RAG"
    );

    console.log(
      "=================================="
    );

    console.log(
      `Student page: http://localhost:${PORT}`
    );

    console.log(
      `Admin page:   http://localhost:${PORT}/admin`
    );

    console.log("");

    console.log(
      "Features:"
    );

    console.log(
      "✓ 100 MB PDF upload"
    );

    console.log(
      "✓ Normal PDF text extraction"
    );

    console.log(
      "✓ Page/chunk text storage"
    );

    console.log(
      "✓ Topic-aware search"
    );

    console.log(
      "✓ Keyword search"
    );

    console.log(
      "✓ Related chunk retrieval"
    );

    console.log(
      "✓ Gemini answers"
    );

    console.log(
      "✓ Supabase text/chunk storage"
    );

    console.log(
      "✓ Cloudflare Worker CORS"
    );

    console.log(
      "=================================="
    );

  }
);
```
