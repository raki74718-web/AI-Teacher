require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

const PORT = process.env.PORT || 3000;


/* =========================================================
   ENVIRONMENT
========================================================= */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const GEMINI_API_KEY = process.env.AI_API_KEY || "";

const GEMINI_MODEL =
  process.env.AI_MODEL || "gemini-3.6-flash";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY || "";


/* =========================================================
   ENV CHECK
========================================================= */

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

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
);

const STORAGE_BUCKET = "books";


/* =========================================================
   GEMINI
========================================================= */

const genAI = new GoogleGenerativeAI(
  GEMINI_API_KEY
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

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================================================
   ADMIN TOKENS
========================================================= */

const adminTokens = new Set();


function createAdminToken() {

  return crypto
    .randomBytes(32)
    .toString("hex");

}


function checkAdminToken(req) {

  const token =
    req.headers["x-admin-token"];

  if (!token) {
    return false;
  }

  return adminTokens.has(token);

}


/* =========================================================
   TEMP DIRECTORY
========================================================= */

const tmpDir = path.join(
  __dirname,
  "tmp"
);


if (!fs.existsSync(tmpDir)) {

  fs.mkdirSync(
    tmpDir,
    {
      recursive: true
    }
  );

}


/* =========================================================
   MULTER
========================================================= */

const storage =
  multer.diskStorage({

    destination: function (
      req,
      file,
      cb
    ) {

      cb(
        null,
        tmpDir
      );

    },

    filename: function (
      req,
      file,
      cb
    ) {

      const uniqueName =
        Date.now() +
        "-" +
        crypto
          .randomBytes(6)
          .toString("hex") +
        ".pdf";

      cb(
        null,
        uniqueName
      );

    }

  });


const upload =
  multer({

    storage,

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

  if (!text) {
    return "";
  }

  return String(text)

    .replace(
      /\r\n/g,
      "\n"
    )

    .replace(
      /\r/g,
      "\n"
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
   QUESTION NORMALIZATION
========================================================= */

function normalizeQuestion(text) {

  return String(text || "")

    .toLowerCase()

    .replace(
      /[^a-z0-9\s]/g,
      " "
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


/* =========================================================
   KEYWORDS
========================================================= */

function getKeywords(question) {

  const stopWords =
    new Set([

      "what",
      "is",
      "are",
      "the",
      "a",
      "an",
      "of",
      "and",
      "or",
      "to",
      "in",
      "on",
      "for",
      "with",
      "from",
      "by",
      "explain",
      "describe",
      "write",
      "about",
      "give",
      "me",
      "please",
      "how",
      "why",
      "can",
      "you",
      "its",
      "their",
      "this",
      "that",
      "using",
      "example",
      "examples",
      "following",
      "according",
      "definition",
      "define",
      "show",
      "tell",
      "briefly",
      "detail",
      "detailed",
      "marks",
      "mark"
    ]);


  return normalizeQuestion(question)

    .split(" ")

    .filter(function (word) {

      return (
        word.length >= 2 &&
        !stopWords.has(word)
      );

    });

}


/* =========================================================
   TOPIC DETECTION
========================================================= */

function detectTopics(question) {

  const q =
    normalizeQuestion(question);

  const topics = [];


  const aliases = {

    avl: [
      "avl",
      "avl tree",
      "avl trees",
      "balanced binary search tree"
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
      "peek"
    ],

    queue: [
      "queue",
      "queues",
      "enqueue",
      "dequeue"
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
      "sort",
      "bubble sort",
      "selection sort",
      "insertion sort",
      "merge sort",
      "quick sort",
      "heap sort"
    ],

    searching: [
      "searching",
      "search",
      "linear search",
      "binary search"
    ],

    array: [
      "array",
      "arrays"
    ],

    recursion: [
      "recursion",
      "recursive"
    ],

    hashing: [
      "hash",
      "hashing",
      "hash table",
      "hash tables"
    ]

  };


  for (
    const topic in aliases
  ) {

    for (
      const alias of aliases[topic]
    ) {

      if (q.includes(alias)) {

        topics.push(topic);

        break;

      }

    }

  }


  return [
    ...new Set(topics)
  ];

}


/* =========================================================
   CHUNK SETTINGS
========================================================= */

const CHUNK_SIZE = 2500;

const CHUNK_OVERLAP = 300;

const TOP_K_CHUNKS = 10;


/* =========================================================
   PAGE-AWARE CHUNK CREATION
========================================================= */

function createChunks(pageData) {

  const chunks = [];

  let id = 1;


  if (
    typeof pageData ===
    "string"
  ) {

    pageData = [
      {
        page: 1,
        text: pageData
      }
    ];

  }


  for (
    const page of pageData
  ) {

    const pageNumber =
      Number(page.page || 1);

    const cleaned =
      cleanText(page.text);


    if (!cleaned) {
      continue;
    }


    let start = 0;


    while (
      start < cleaned.length
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

        }

        else if (
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

          id: id,

          page: pageNumber,

          text: chunkText

        });

        id++;

      }


      const nextStart =
        end -
        CHUNK_OVERLAP;


      if (
        nextStart <=
        start
      ) {

        start = end;

      }

      else {

        start =
          nextStart;

      }

    }

  }


  return chunks;

}


/* =========================================================
   TRUE PDF PAGE-BY-PAGE EXTRACTION
========================================================= */

async function extractPdfText(
  filePath
) {

  console.log(
    "PDF buffer loaded."
  );


  const buffer =
    fs.readFileSync(
      filePath
    );


  /*
   * pdfjs-dist v4 is ESM.
   * Dynamic import keeps this
   * server.js in CommonJS mode.
   */

  const pdfjsLib =
    await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );


  const loadingTask =
    pdfjsLib.getDocument({

      data:
        new Uint8Array(
          buffer
        ),

      useWorkerFetch:
        false,

      isEvalSupported:
        true

    });


  const pdf =
    await loadingTask.promise;


  const totalPages =
    pdf.numPages;


  console.log(
    "Pages:",
    totalPages
  );


  const pageData = [];


  /*
   * Extract every PDF page separately.
   */

  for (
    let pageNumber = 1;
    pageNumber <= totalPages;
    pageNumber++
  ) {

    const page =
      await pdf.getPage(
        pageNumber
      );


    const textContent =
      await page.getTextContent();


    let pageText = "";


    for (
      const item of
      textContent.items
    ) {

      if (
        item &&
        typeof item.str ===
        "string"
      ) {

        pageText +=
          item.str;

        if (
          item.hasEOL
        ) {

          pageText +=
            "\n";

        }

        else {

          pageText +=
            " ";

        }

      }

    }


    pageText =
      cleanText(
        pageText
      );


    pageData.push({

      page:
        pageNumber,

      text:
        pageText

    });


    console.log(
      "Page",
      pageNumber,
      "characters:",
      pageText.length
    );

  }


  const combinedText =
    pageData

      .map(function (page) {

        return page.text;

      })

      .filter(function (text) {

        return text.length > 0;

      })

      .join("\n\n");


  console.log(
    "Characters:",
    combinedText.length
  );


  const readablePages =
    pageData.filter(function (page) {

      return page.text.length > 0;

    });


  console.log(
    "Readable pages:",
    readablePages.length
  );


  return {

    text:
      combinedText,

    pages:
      totalPages,

    pageData:
      pageData

  };

}


/* =========================================================
   SUPABASE TEXT UPLOAD
========================================================= */

async function uploadTextFile(
  filePath,
  content
) {

  const buffer =
    Buffer.from(
      content,
      "utf8"
    );


  const {
    error
  } =
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


/* =========================================================
   SUPABASE JSON UPLOAD
========================================================= */

async function uploadJsonFile(
  filePath,
  data
) {

  const buffer =
    Buffer.from(
      JSON.stringify(data),
      "utf8"
    );


  const {
    error
  } =
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


/* =========================================================
   SUPABASE DOWNLOAD TEXT
========================================================= */

async function downloadTextFile(
  filePath
) {

  const {
    data,
    error
  } =
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


  if (!data) {

    throw new Error(
      "Textbook file not found."
    );

  }


  const arrayBuffer =
    await data.arrayBuffer();


  return Buffer
    .from(arrayBuffer)
    .toString("utf8");

}


/* =========================================================
   SUPABASE DOWNLOAD JSON
========================================================= */

async function downloadJsonFile(
  filePath
) {

  const {
    data,
    error
  } =
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


  if (!data) {

    throw new Error(
      "Textbook chunks file not found."
    );

  }


  const arrayBuffer =
    await data.arrayBuffer();


  const text =
    Buffer
      .from(arrayBuffer)
      .toString("utf8");


  return JSON.parse(text);

}


/* =========================================================
   TOPIC MATCH HELPER
========================================================= */

function topicMatchesText(
  topic,
  text
) {

  if (topic === "avl") {

    return (
      text.includes("avl") ||
      text.includes("rotation") ||
      text.includes("balance")
    );

  }


  if (topic === "bst") {

    return (
      text.includes(
        "binary search tree"
      ) ||
      text.includes("bst")
    );

  }


  if (topic === "stack") {

    return (
      text.includes("stack") ||
      text.includes("push") ||
      text.includes("pop")
    );

  }


  if (topic === "queue") {

    return (
      text.includes("queue") ||
      text.includes("enqueue") ||
      text.includes("dequeue")
    );

  }


  if (topic === "linkedlist") {

    return text.includes(
      "linked list"
    );

  }


  if (topic === "tree") {

    return text.includes(
      "tree"
    );

  }


  if (topic === "graph") {

    return (
      text.includes("graph") ||
      text.includes("bfs") ||
      text.includes("dfs")
    );

  }


  if (topic === "sorting") {

    return (
      text.includes("sort") ||
      text.includes("sorting")
    );

  }


  if (topic === "searching") {

    return (
      text.includes("search") ||
      text.includes("searching")
    );

  }


  if (topic === "array") {

    return text.includes(
      "array"
    );

  }


  if (topic === "recursion") {

    return (
      text.includes("recursion") ||
      text.includes("recursive")
    );

  }


  if (topic === "hashing") {

    return (
      text.includes("hash") ||
      text.includes("hashing")
    );

  }


  return text.includes(topic);

}


/* =========================================================
   RAG SEARCH
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


  const keywords =
    getKeywords(
      question
    );


  const topics =
    detectTopics(
      question
    );


  console.log(
    "=================================="
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
      function (
        chunk,
        index
      ) {

        const text =
          normalizeQuestion(
            chunk.text
          );


        let score = 0;


        /*
         * Exact question phrase
         */

        if (
          q.length > 4 &&
          text.includes(q)
        ) {

          score += 10;

        }


        /*
         * Keyword matching
         */

        for (
          const keyword of keywords
        ) {

          if (
            text.includes(keyword)
          ) {

            score += 2;

          }

        }


        /*
         * Topic matching
         */

        for (
          const topic of topics
        ) {

          if (
            topicMatchesText(
              topic,
              text
            )
          ) {

            score += 6;

          }


          /*
           * Extra topic boosts
           */

          if (
            topic === "avl"
          ) {

            if (
              text.includes("avl")
            ) {

              score += 8;

            }

            if (
              text.includes("rotation")
            ) {

              score += 4;

            }

            if (
              text.includes("balance")
            ) {

              score += 3;

            }

          }


          if (
            topic === "stack"
          ) {

            if (
              text.includes("stack")
            ) {

              score += 7;

            }

            if (
              text.includes("push")
            ) {

              score += 3;

            }

            if (
              text.includes("pop")
            ) {

              score += 3;

            }

          }


          if (
            topic === "bst" &&
            text.includes(
              "binary search tree"
            )
          ) {

            score += 8;

          }


          if (
            topic === "queue" &&
            text.includes(
              "queue"
            )
          ) {

            score += 7;

          }

        }


        return {

          index:
            index,

          id:
            Number(chunk.id),

          page:
            Number(
              chunk.page || 1
            ),

          text:
            chunk.text,

          score:
            score

        };

      }
    );


  let relevant =
    scored

      .filter(function (item) {

        return item.score > 0;

      })

      .sort(function (
        a,
        b
      ) {

        return b.score -
          a.score;

      });


  /*
   * Topic fallback
   */

  if (
    relevant.length === 0 &&
    topics.length > 0
  ) {

    relevant =
      scored

        .filter(function (item) {

          const text =
            normalizeQuestion(
              item.text
            );


          return topics.some(
            function (topic) {

              return topicMatchesText(
                topic,
                text
              );

            }
          );

        })

        .sort(function (
          a,
          b
        ) {

          return b.score -
            a.score;

        });

  }


  relevant =
    relevant.slice(
      0,
      TOP_K_CHUNKS
    );


  console.log(
    "Relevant chunks:",
    relevant.length
  );


  console.log(
    "Top matches:",
    relevant.map(
      function (item) {

        return (
          "ID:" +
          item.id +
          " Page:" +
          item.page +
          " Score:" +
          item.score
        );

      }
    )
  );


  /*
   * Add neighboring chunks.
   */

  const finalMap =
    new Map();


  for (
    const item of relevant
  ) {

    finalMap.set(
      item.id,
      item
    );


    const previous =
      chunks.find(
        function (chunk) {

          return (
            Number(chunk.id) ===
            item.id - 1
          );

        }
      );


    const next =
      chunks.find(
        function (chunk) {

          return (
            Number(chunk.id) ===
            item.id + 1
          );

        }
      );


    if (previous) {

      finalMap.set(
        Number(previous.id),
        {

          ...previous,

          id:
            Number(previous.id),

          page:
            Number(
              previous.page || 1
            ),

          score:
            Math.max(
              1,
              item.score - 1
            )

        }
      );

    }


    if (next) {

      finalMap.set(
        Number(next.id),
        {

          ...next,

          id:
            Number(next.id),

          page:
            Number(
              next.page || 1
            ),

          score:
            Math.max(
              1,
              item.score - 1
            )

        }
      );

    }

  }


  return Array
    .from(
      finalMap.values()
    )

    .sort(function (
      a,
      b
    ) {

      return b.score -
        a.score;

    })

    .slice(
      0,
      TOP_K_CHUNKS
    );

}


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  "/api/admin/login",
  function (
    req,
    res
  ) {

    try {

      const password =
        req.body &&
        req.body.password;


      if (
        !password ||
        password !==
        ADMIN_PASSWORD
      ) {

        return res
          .status(401)
          .json({

            error:
              "Invalid admin password."

          });

      }


      const token =
        createAdminToken();


      adminTokens.add(
        token
      );


      return res.json({

        success:
          true,

        token:
          token

      });

    }

    catch (error) {

      console.error(
        "ADMIN LOGIN ERROR:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            "Admin login failed."

        });

    }

  }
);


/* =========================================================
   GET SUBJECTS
========================================================= */

app.get(
  "/api/subjects",
  async function (
    req,
    res
  ) {

    try {

      const {
        data,
        error
      } =
        await supabase
          .from("subjects")
          .select("*")
          .order(
            "name",
            {
              ascending:
                true
            }
          );


      if (error) {

        throw error;

      }


      return res.json(
        data || []
      );

    }

    catch (error) {

      console.error(
        "GET SUBJECTS ERROR:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message ||
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
  async function (
    req,
    res
  ) {

    try {

      if (
        !checkAdminToken(req)
      ) {

        return res
          .status(401)
          .json({

            error:
              "Unauthorized."

          });

      }


      const {
        data,
        error
      } =
        await supabase
          .from("subjects")
          .select("*")
          .order(
            "name",
            {
              ascending:
                true
            }
          );


      if (error) {

        throw error;

      }


      return res.json(
        data || []
      );

    }

    catch (error) {

      console.error(
        "ADMIN SUBJECTS ERROR:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message ||
            "Could not load subjects."

        });

    }

  }
);


/* =========================================================
   ADMIN PDF UPLOAD
========================================================= */

app.post(
  "/api/admin/upload",
  upload.single("book"),
  async function (
    req,
    res
  ) {

    let uploadedFile = null;


    try {

      if (
        !checkAdminToken(req)
      ) {

        return res
          .status(401)
          .json({

            error:
              "Unauthorized."

          });

      }


      uploadedFile =
        req.file;


      if (!uploadedFile) {

        return res
          .status(400)
          .json({

            error:
              "Please upload a PDF."

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
        "=================================="
      );

      console.log(
        "PDF UPLOAD STARTED"
      );

      console.log(
        "File:",
        uploadedFile.originalname
      );

      console.log(
        "Size:",
        uploadedFile.size,
        "bytes"
      );

      console.log(
        "=================================="
      );


      /*
       * Extract every page separately.
       */

      const extracted =
        await extractPdfText(
          uploadedFile.path
        );


      if (
        !extracted.text ||
        extracted.text.length < 20
      ) {

        return res
          .status(400)
          .json({

            error:
              "Could not extract readable text from this PDF. If this is a scanned PDF, OCR processing is required."

          });

      }


      console.log(
        "Creating chunks..."
      );


      const chunks =
        createChunks(
          extracted.pageData
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


      const chunkPages =
        [
          ...new Set(
            chunks.map(
              function (chunk) {

                return Number(
                  chunk.page
                );

              }
            )
          )
        ]
          .sort(function (
            a,
            b
          ) {

            return a - b;

          });


      console.log(
        "Chunk pages:",
        chunkPages.join(", ")
      );


      /*
       * Create subject ID.
       */

      const subjectId =
        crypto
          .randomBytes(8)
          .toString("hex");


      const textPath =
        "books/" +
        subjectId +
        "/book.txt";


      const chunksPath =
        "books/" +
        subjectId +
        "/chunks.json";


      /*
       * IMPORTANT:
       * We do NOT upload the original PDF.
       *
       * Supabase Free Storage has a
       * file-size limitation.
       *
       * We store only extracted text
       * and chunks JSON.
       */

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


      /*
       * Save subject metadata.
       */

      const {
        error:
          subjectError
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


      if (subjectError) {

        throw subjectError;

      }


      console.log(
        "Subject saved:",
        subjectId
      );


      /*
       * Delete temporary PDF.
       */

      try {

        fs.unlinkSync(
          uploadedFile.path
        );

      }

      catch (cleanupError) {

        console.log(
          "Temporary PDF cleanup warning:",
          cleanupError.message
        );

      }


      return res.json({

        success:
          true,

        subjectId:
          subjectId,

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
            chunks.length,

          text_path:
            textPath,

          chunks_path:
            chunksPath

        }

      });

    }

    catch (error) {

      console.error(
        "BOOK UPLOAD ERROR:",
        error
      );


      if (
        uploadedFile &&
        uploadedFile.path
      ) {

        try {

          fs.unlinkSync(
            uploadedFile.path
          );

        }

        catch (cleanupError) {}

      }


      return res
        .status(500)
        .json({

          error:
            error.message ||
            "Could not process the PDF."

        });

    }

  }
);


/* =========================================================
   ASK AI TEACHER
========================================================= */

app.post(
  "/api/ask",
  async function (
    req,
    res
  ) {

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


      console.log(
        "=================================="
      );

      console.log(
        "Question for:",
        subjectId,
        ":",
        question
      );

      console.log(
        "=================================="
      );


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
              "Please enter a question."

          });

      }


      /*
       * Find subject.
       */

      const {
        data:
          subject,
        error:
          subjectError
      } =
        await supabase
          .from("subjects")
          .select("*")
          .eq(
            "id",
            subjectId
          )
          .single();


      if (subjectError) {

        throw subjectError;

      }


      if (!subject) {

        return res
          .status(404)
          .json({

            error:
              "Subject not found."

          });

      }


      let chunks = [];


      /*
       * Load new page-aware chunks.
       */

      if (
        subject.chunks_path
      ) {

        console.log(
          "Loading chunks:",
          subject.chunks_path
        );


        try {

          chunks =
            await downloadJsonFile(
              subject.chunks_path
            );

        }

        catch (error) {

          console.log(
            "chunks.json load failed:",
            error.message
          );

        }

      }


      /*
       * Compatibility with old books.
       *
       * Old books may only have text_path.
       * Their original page information
       * cannot be recovered here.
       */

      if (
        !Array.isArray(chunks) ||
        chunks.length === 0
      ) {

        if (
          subject.text_path
        ) {

          console.log(
            "Using old textbook text_path"
          );


          const oldText =
            await downloadTextFile(
              subject.text_path
            );


          chunks =
            createChunks([
              {

                page:
                  1,

                text:
                  oldText

              }
            ]);


          console.log(
            "Rebuilt chunks:",
            chunks.length
          );

        }

      }


      if (
        !Array.isArray(chunks) ||
        chunks.length === 0
      ) {

        return res
          .status(500)
          .json({

            error:
              "Textbook content is not available."

          });

      }


      /*
       * Search textbook.
       */

      const relevantChunks =
        searchChunks(
          question,
          chunks
        );


      if (
        relevantChunks.length === 0
      ) {

        return res.json({

          answer:
            "I could not find this topic in the uploaded textbook. Please ask a question related to the selected subject.",

          source: {

            subject:
              subject.name,

            pages:
              []

          },

          sourcePages:
            []

        });

      }


      /*
       * Build context.
       */

      const context =
        relevantChunks
          .map(function (chunk) {

            return (
              "[Textbook Page " +
              Number(chunk.page || 1) +
              "]\n" +
              chunk.text
            );

          })
          .join(
            "\n\n---\n\n"
          );


      /*
       * Gemini model.
       */

      const model =
        genAI.getGenerativeModel({

          model:
            GEMINI_MODEL

        });


      const prompt =

`You are AI Teacher, a B.Tech textbook learning assistant.

IMPORTANT RULES:

1. Answer ONLY using the provided textbook context.
2. Do NOT invent information that is not supported by the textbook.
3. If the textbook context does not contain enough information, clearly say that the information is not found in the uploaded textbook.
4. Do not use outside knowledge to fill missing details.
5. Explain in simple language suitable for B.Tech students.
6. If the student asks for a 10-mark answer, structure it like an exam answer.
7. Use headings, points, examples and conclusion when supported by the textbook.
8. Do not claim an exact textbook page inside the answer unless that page number appears in the provided context.
9. Keep the answer focused on the student's question.
10. Do not mention information that is not supported by the textbook.

TEXTBOOK CONTEXT:

${context}

STUDENT QUESTION:

${question}

Now answer the student's question using ONLY the textbook context.`;


      const result =
        await model.generateContent(
          prompt
        );


      const answer =
        result.response.text();


      /*
       * Get exact source pages.
       */

      const sourcePages =
        [
          ...new Set(
            relevantChunks
              .map(function (chunk) {

                return Number(
                  chunk.page
                );

              })
              .filter(function (page) {

                return (
                  Number.isFinite(page) &&
                  page > 0
                );

              })
          )
        ]
          .sort(function (
            a,
            b
          ) {

            return a - b;

          });


      console.log(
        "Selected chunk pages:",
        sourcePages
      );


      return res.json({

        answer:
          answer,

        source: {

          subject:
            subject.name,

          pages:
            sourcePages

        },

        sourcePages:
          sourcePages

      });

    }

    catch (error) {

      console.error(
        "ASK ERROR:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message ||
            "Could not generate the answer."

        });

    }

  }
);


/* =========================================================
   DELETE SUBJECT
========================================================= */

app.delete(
  "/api/admin/subjects/:id",
  async function (
    req,
    res
  ) {

    try {

      if (
        !checkAdminToken(req)
      ) {

        return res
          .status(401)
          .json({

            error:
              "Unauthorized."

          });

      }


      const subjectId =
        req.params.id;


      const {
        data:
          subject,
        error:
          findError
      } =
        await supabase
          .from("subjects")
          .select("*")
          .eq(
            "id",
            subjectId
          )
          .single();


      if (findError) {

        throw findError;

      }


      const filesToDelete = [];


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
        filesToDelete.length > 0
      ) {

        const {
          error:
            storageError
        } =
          await supabase
            .storage
            .from(
              STORAGE_BUCKET
            )
            .remove(
              filesToDelete
            );


        if (storageError) {

          console.log(
            "Storage delete warning:",
            storageError.message
          );

        }

      }


      const {
        error
      } =
        await supabase
          .from("subjects")
          .delete()
          .eq(
            "id",
            subjectId
          );


      if (error) {

        throw error;

      }


      return res.json({

        success:
          true

      });

    }

    catch (error) {

      console.error(
        "DELETE SUBJECT ERROR:",
        error
      );


      return res
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
   MULTER ERROR HANDLER
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
          .status(413)
          .json({

            error:
              "PDF file is too large. Maximum allowed size is 100 MB."

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

      return res
        .status(400)
        .json({

          error:
            error.message ||
            "Upload error."

        });

    }


    next();

  }
);


/* =========================================================
   ROUTES
========================================================= */

app.get(
  "/",
  function (
    req,
    res
  ) {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);


app.get(
  "/admin",
  function (
    req,
    res
  ) {

    res.sendFile(
      path.join(
        __dirname,
        "public",
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
  function () {

    console.log("");

    console.log(
      "=================================="
    );

    console.log(
      "AI Teacher V2 - Page Aware RAG"
    );

    console.log(
      "=================================="
    );

    console.log(
      "Student page:",
      "http://localhost:" +
      PORT
    );

    console.log(
      "Admin page:",
      "http://localhost:" +
      PORT +
      "/admin"
    );

    console.log("");

    console.log(
      "Features:"
    );

    console.log(
      "✓ 100 MB PDF upload"
    );

    console.log(
      "✓ True page-by-page PDF extraction"
    );

    console.log(
      "✓ Page-aware chunks"
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
      "✓ Source + exact page metadata"
    );

    console.log(
      "✓ Existing saved books compatibility"
    );

    console.log(
      "=================================="
    );

  }
);