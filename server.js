require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

/* =========================================================
   CORS
========================================================= */

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, x-admin-token"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   ENVIRONMENT
========================================================= */

const PORT = process.env.PORT || 3000;

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
  express.static(publicPath)
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
  !fs.existsSync(tempPath)
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
   PDF UPLOAD
   100 MB
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
              unique + ".pdf"
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
        if (
          file.mimetype !==
          "application/pdf"
        ) {
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
   ADVERTISEMENT UPLOAD
   5 MB
========================================================= */

const adUpload =
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

            const ext =
              path
                .extname(
                  file.originalname
                )
                .toLowerCase();

            cb(
              null,
              unique + ext
            );
          }
      }),

    limits: {
      fileSize:
        5 *
        1024 *
        1024
    },

    fileFilter:
      function (
        req,
        file,
        cb
      ) {
        const allowed = [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif"
        ];

        if (
          !allowed.includes(
            file.mimetype
          )
        ) {
          return cb(
            new Error(
              "Only JPG, PNG, WEBP and GIF images are allowed."
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
    .replace(/\r/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* =========================================================
   CREATE PAGE-AWARE CHUNKS
========================================================= */

const CHUNK_SIZE =
  2500;

const CHUNK_OVERLAP =
  300;

const TOP_K_CHUNKS =
  8;

function createChunks(
  pageTexts
) {
  const chunks = [];

  let id = 1;

  for (
    const pageData
    of pageTexts
  ) {
    const pageNumber =
      pageData.page;

    const pageText =
      cleanText(
        pageData.text
      );

    if (!pageText) {
      continue;
    }

    let start = 0;

    while (
      start <
      pageText.length
    ) {
      let end =
        start +
        CHUNK_SIZE;

      if (
        end <
        pageText.length
      ) {
        const paragraphBreak =
          pageText.lastIndexOf(
            "\n",
            end
          );

        const sentenceBreak =
          pageText.lastIndexOf(
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
            sentenceBreak +
            1;
        }
      }

      const chunkText =
        pageText
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
      } else {
        start =
          nextStart;
      }
    }
  }

  return chunks;
}

/* =========================================================
   NORMALIZE QUESTION
========================================================= */

function normalizeQuestion(
  text
) {
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
   QUESTION TYPE
========================================================= */

function detectQuestionType(
  question
) {
  const q =
    normalizeQuestion(
      question
    );

  const isTenMarks =
    /\b10\s*(marks?|mark)\b/.test(
      q
    ) ||
    q.includes(
      "ten marks"
    ) ||
    q.includes(
      "10 mark answer"
    );

  if (isTenMarks) {
    return "10_MARKS";
  }

  if (
    /\b(different ways|different methods|ways|methods|types|list|list out|enumerate)\b/.test(
      q
    )
  ) {
    return "LIST";
  }

  if (
    /\b(define|definition|what is|what are)\b/.test(
      q
    )
  ) {
    return "DEFINITION";
  }

  if (
    /\b(how|steps|procedure|algorithm)\b/.test(
      q
    )
  ) {
    return "HOW";
  }

  if (
    /\b(why|reason|reasons)\b/.test(
      q
    )
  ) {
    return "WHY";
  }

  if (
    /\b(difference|differences|compare|comparison|distinguish)\b/.test(
      q
    )
  ) {
    return "COMPARISON";
  }

  if (
    /\b(formula|equation)\b/.test(
      q
    )
  ) {
    return "FORMULA";
  }

  if (
    /\b(example|examples)\b/.test(
      q
    )
  ) {
    return "EXAMPLE";
  }

  return "SHORT";
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
    quadratic: [
      "quadratic",
      "quadratic equation",
      "quadratic equations",
      "quadratic formula",
      "completing square",
      "completing the square",
      "factoring quadratic",
      "roots of quadratic",
      "roots quadratic"
    ],

    linear: [
      "linear",
      "linear equation",
      "linear equations",
      "linear function"
    ],

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
      "definition",
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
      "can",
      "could",
      "would",
      "should",
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
      "used",
      "different",
      "ways",
      "way",
      "solution",
      "solutions",
      "find",
      "finding",
      "use"
    ]);

  const words =
    q.split(/\s+/)
      .filter(
        word =>
          word.length >= 2
      );

  const keywords =
    words.filter(
      word =>
        !stopWords.has(
          word
        )
    );

  const topics = [];

  for (
    const [
      topic,
      aliases
    ]
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
    "Question type:",
    detectQuestionType(
      question
    )
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
            score += 3;
          }
        }

        if (
          q.length >= 8 &&
          text.includes(q)
        ) {
          score += 15;
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
              text.includes(
                alias
              )
            ) {
              score += 5;
            }
          }
        }

        if (
          topics.includes(
            "quadratic"
          )
        ) {
          if (
            text.includes(
              "quadratic"
            )
          ) {
            score += 20;
          }

          if (
            text.includes(
              "quadratic formula"
            )
          ) {
            score += 10;
          }

          if (
            text.includes(
              "factoring"
            )
          ) {
            score += 6;
          }

          if (
            text.includes(
              "completing the square"
            ) ||
            text.includes(
              "completing square"
            )
          ) {
            score += 6;
          }

          if (
            text.includes(
              "square root"
            )
          ) {
            score += 5;
          }
        }

        if (
          topics.includes(
            "avl"
          )
        ) {
          if (
            text.includes(
              "avl"
            )
          ) {
            score += 20;
          }

          if (
            text.includes(
              "rotation"
            )
          ) {
            score += 10;
          }

          if (
            text.includes(
              "balance"
            )
          ) {
            score += 6;
          }

          if (
            text.includes(
              "height"
            )
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
          topics.includes(
            "stack"
          )
        ) {
          if (
            text.includes(
              "stack"
            )
          ) {
            score += 15;
          }

          if (
            text.includes(
              "push"
            )
          ) {
            score += 6;
          }

          if (
            text.includes(
              "pop"
            )
          ) {
            score += 6;
          }

          if (
            text.includes(
              "peek"
            )
          ) {
            score += 5;
          }

          if (
            text.includes(
              "lifo"
            )
          ) {
            score += 5;
          }
        }

        if (
          topics.includes(
            "bst"
          )
        ) {
          if (
            text.includes(
              "bst"
            )
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
          topics.includes(
            "queue"
          )
        ) {
          if (
            text.includes(
              "queue"
            )
          ) {
            score += 15;
          }

          if (
            text.includes(
              "enqueue"
            )
          ) {
            score += 6;
          }

          if (
            text.includes(
              "dequeue"
            )
          ) {
            score += 6;
          }

          if (
            text.includes(
              "fifo"
            )
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

  /* Topic fallback */

  if (
    selected.length === 0 &&
    topics.length > 0
  ) {
    const aliases = [];

    for (
      const topic
      of topics
    ) {
      aliases.push(
        ...(topicAliases[
          topic
        ] || [])
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
                text.includes(
                  alias
                )
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

  /* Add nearby chunks without changing relevance order */

  const resultItems = [];

  const addedIndexes =
    new Set();

  for (
    const item
    of selected
  ) {
    if (
      !addedIndexes.has(
        item.index
      )
    ) {
      resultItems.push(
        item
      );

      addedIndexes.add(
        item.index
      );
    }

    if (
      item.index > 0 &&
      resultItems.length <
        TOP_K_CHUNKS + 2
    ) {
      const previousIndex =
        item.index - 1;

      if (
        !addedIndexes.has(
          previousIndex
        )
      ) {
        resultItems.push({
          chunk:
            chunks[
              previousIndex
            ],
          index:
            previousIndex,
          score:
            0
        });

        addedIndexes.add(
          previousIndex
        );
      }
    }

    if (
      item.index <
        chunks.length - 1 &&
      resultItems.length <
        TOP_K_CHUNKS + 2
    ) {
      const nextIndex =
        item.index + 1;

      if (
        !addedIndexes.has(
          nextIndex
        )
      ) {
        resultItems.push({
          chunk:
            chunks[
              nextIndex
            ],
          index:
            nextIndex,
          score:
            0
        });

        addedIndexes.add(
          nextIndex
        );
      }
    }
  }

  const results =
    resultItems
      .slice(
        0,
        TOP_K_CHUNKS + 2
      )
      .map(
        item =>
          item.chunk
      );

  console.log(
    "Relevant chunks:",
    results.length
  );

  console.log(
    "Relevant source pages:",
    results
      .map(
        chunk =>
          chunk.page
      )
      .filter(Boolean)
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
            `${item.index}(page:${item.chunk.page}, score:${item.score})`
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

const ADS_BUCKET =
  "ads";

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
    await supabase.storage
      .from(
        STORAGE_BUCKET
      )
      .upload(
        filePath,
        buffer,
        {
          contentType:
            "text/plain",
          upsert: true
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
      JSON.stringify(
        data
      ),
      "utf8"
    );

  const {
    error
  } =
    await supabase.storage
      .from(
        STORAGE_BUCKET
      )
      .upload(
        filePath,
        buffer,
        {
          contentType:
            "application/json",
          upsert: true
        }
      );

  if (error) {
    throw error;
  }
}

async function downloadJsonFile(
  filePath
) {
  const {
    data,
    error
  } =
    await supabase.storage
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
   PAGE-WISE PDF EXTRACTION
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

  const pdfjsLib =
    await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );

  const loadingTask =
    pdfjsLib.getDocument({
      data: new Uint8Array(buffer)
    });

  const pdf =
    await loadingTask.promise;

  console.log(
    "Pages:",
    pdf.numPages
  );

  const pageTexts = [];

  for (
    let pageNumber = 1;
    pageNumber <=
      pdf.numPages;
    pageNumber++
  ) {
    const page =
      await pdf.getPage(
        pageNumber
      );

    const content =
      await page.getTextContent();

    const pageText =
      content.items
        .map(
          item =>
            item.str
        )
        .join(" ")
        .trim();

    pageTexts.push({
      page:
        pageNumber,
      text:
        pageText
    });

    console.log(
      `Page ${pageNumber}: ${pageText.length} characters`
    );
  }

  const text =
    pageTexts
      .map(
        item =>
          item.text
      )
      .join("\n");

  console.log(
    "Characters:",
    text.length
  );

  return {
    text:
      cleanText(text),
    pages:
      pdf.numPages,
    pageTexts
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
    !adminTokens.has(
      token
    )
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
   ADMIN LOGIN
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
   UPLOAD ADVERTISEMENT
========================================================= */

app.post(
  "/api/admin/ads",
  adminAuth,
  adUpload.single("image"),
  async (
    req,
    res
  ) => {
    let tempFile =
      null;

    let newFilePath =
      null;

    try {
      const position =
        String(
          req.body.position ||
            ""
        )
          .trim()
          .toLowerCase();

      const targetUrl =
        String(
          req.body.targetUrl ||
            ""
        ).trim();

      if (
        ![
          "left",
          "right"
        ].includes(
          position
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Position must be left or right."
          });
      }

      if (!req.file) {
        return res
          .status(400)
          .json({
            error:
              "Advertisement image is required."
          });
      }

      tempFile =
        req.file.path;

      const ext =
        path
          .extname(
            req.file.originalname
          )
          .toLowerCase();

      newFilePath =
        `ads/${position}-` +
        crypto
          .randomBytes(8)
          .toString("hex") +
        ext;

      const fileBuffer =
        fs.readFileSync(
          tempFile
        );

      const {
        error:
          uploadError
      } =
        await supabase.storage
          .from(
            ADS_BUCKET
          )
          .upload(
            newFilePath,
            fileBuffer,
            {
              contentType:
                req.file.mimetype,
              upsert: false
            }
          );

      if (uploadError) {
        throw uploadError;
      }

      const {
        data:
          publicData
      } =
        supabase.storage
          .from(
            ADS_BUCKET
          )
          .getPublicUrl(
            newFilePath
          );

      const imageUrl =
        publicData.publicUrl;

      const {
        data: oldAd,
        error: oldAdError
      } =
        await supabase
          .from(
            "advertisements"
          )
          .select("*")
          .eq(
            "position",
            position
          )
          .maybeSingle();

      if (oldAdError) {
        throw oldAdError;
      }

      if (oldAd) {
        const {
          error:
            updateError
        } =
          await supabase
            .from(
              "advertisements"
            )
            .update({
              image_url:
                imageUrl,

              image_path:
                newFilePath,

              target_url:
                targetUrl ||
                null,

              active:
                true,

              updated_at:
                new Date()
                  .toISOString()
            })
            .eq(
              "id",
              oldAd.id
            );

        if (updateError) {
          throw updateError;
        }

        if (
          oldAd.image_path &&
          oldAd.image_path !==
            newFilePath
        ) {
          const {
            error:
              removeError
          } =
            await supabase.storage
              .from(
                ADS_BUCKET
              )
              .remove([
                oldAd.image_path
              ]);

          if (removeError) {
            console.error(
              "Old advertisement delete error:",
              removeError
            );
          }
        }
      } else {
        const {
          error:
            insertError
        } =
          await supabase
            .from(
              "advertisements"
            )
            .insert({
              position,
              image_url:
                imageUrl,
              image_path:
                newFilePath,
              target_url:
                targetUrl ||
                null,
              active:
                true,
              updated_at:
                new Date()
                  .toISOString()
            });

        if (insertError) {
          throw insertError;
        }
      }

      if (
        tempFile &&
        fs.existsSync(
          tempFile
        )
      ) {
        fs.unlinkSync(
          tempFile
        );
      }

      tempFile = null;

      res.json({
        success:
          true,

        message:
          `${position} advertisement updated successfully.`,

        imageUrl
      });
    } catch (error) {
      console.error(
        "ADVERTISEMENT UPLOAD ERROR:",
        error
      );

      if (
        tempFile &&
        fs.existsSync(
          tempFile
        )
      ) {
        try {
          fs.unlinkSync(
            tempFile
          );
        } catch (
          deleteError
        ) {
          console.error(
            "Advertisement temp delete error:",
            deleteError
          );
        }
      }

      if (
        newFilePath
      ) {
        try {
          await supabase.storage
            .from(
              ADS_BUCKET
            )
            .remove([
              newFilePath
            ]);
        } catch (
          cleanupError
        ) {
          console.error(
            "Advertisement storage cleanup error:",
            cleanupError
          );
        }
      }

      res
        .status(500)
        .json({
          error:
            error.message ||
            "Advertisement upload failed."
        });
    }
  }
);

/* =========================================================
   PUBLIC ADS
========================================================= */

app.get(
  "/api/ads",
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
          .from(
            "advertisements"
          )
          .select(
            "position,image_url,target_url,active"
          )
          .eq(
            "active",
            true
          );

      if (error) {
        throw error;
      }

      res.json(
        data || []
      );
    } catch (error) {
      console.error(
        "GET ADS ERROR:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load advertisements."
        });
    }
  }
);

/* =========================================================
   ADMIN ADS
========================================================= */

app.get(
  "/api/admin/ads",
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
          .from(
            "advertisements"
          )
          .select("*")
          .order(
            "position",
            {
              ascending:
                true
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
        "ADMIN ADS ERROR:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not load advertisements."
        });
    }
  }
);

/* =========================================================
   DELETE AD
========================================================= */

app.delete(
  "/api/admin/ads/:position",
  adminAuth,
  async (
    req,
    res
  ) => {
    const position =
      String(
        req.params.position ||
          ""
      )
        .trim()
        .toLowerCase();

    if (
      ![
        "left",
        "right"
      ].includes(
        position
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Position must be left or right."
        });
    }

    try {
      const {
        data: ad,
        error:
          getError
      } =
        await supabase
          .from(
            "advertisements"
          )
          .select("*")
          .eq(
            "position",
            position
          )
          .maybeSingle();

      if (getError) {
        throw getError;
      }

      if (!ad) {
        return res.json({
          success:
            true,
          message:
            "Advertisement not found."
        });
      }

      if (
        ad.image_path
      ) {
        const {
          error:
            storageError
        } =
          await supabase.storage
            .from(
              ADS_BUCKET
            )
            .remove([
              ad.image_path
            ]);

        if (storageError) {
          console.error(
            "Advertisement storage delete error:",
            storageError
          );
        }
      }

      const {
        error:
          deleteError
      } =
        await supabase
          .from(
            "advertisements"
          )
          .delete()
          .eq(
            "id",
            ad.id
          );

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        success:
          true,
        message:
          `${position} advertisement deleted successfully.`
      });
    } catch (error) {
      console.error(
        "DELETE AD ERROR:",
        error
      );

      res
        .status(500)
        .json({
          error:
            error.message ||
            "Could not delete advertisement."
        });
    }
  }
);

/* =========================================================
   PUBLIC SUBJECTS
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
          .from(
            "subjects"
          )
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
          .from(
            "subjects"
          )
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

      /* PAGE-WISE EXTRACTION */

      const extracted =
        await extractPdfText(
          uploadedFile
        );

      if (
        !extracted.text ||
        extracted.text.length <
          20
      ) {
        return res
          .status(400)
          .json({
            error:
              "Could not extract readable text from this PDF."
          });
      }

      console.log(
        "Creating page-aware chunks..."
      );

      const chunks =
        createChunks(
          extracted.pageTexts
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

      console.log(
        "First chunk:",
        chunks[0]
      );

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
        "Uploading page-aware chunks..."
      );

      await uploadJsonFile(
        chunksPath,
        chunks
      );

      const {
        error:
          subjectError
      } =
        await supabase
          .from(
            "subjects"
          )
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

      /* -----------------------------------------
         GET SUBJECT
      ----------------------------------------- */

      const {
        data: subject,
        error:
          subjectError
      } =
        await supabase
          .from(
            "subjects"
          )
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

      /* -----------------------------------------
         GET CHUNKS
      ----------------------------------------- */

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

      if (
        !Array.isArray(
          chunks
        )
      ) {
        return res
          .status(500)
          .json({
            error:
              "Invalid textbook chunks."
          });
      }

      console.log(
        "Total chunks:",
        chunks.length
      );

      /* -----------------------------------------
         SEARCH
      ----------------------------------------- */

      const relevantChunks =
        searchChunks(
          question,
          chunks
        );

      if (
        relevantChunks.length ===
        0
      ) {
        console.log(
          "No relevant chunks found."
        );

        return res.json({
          answer:
            "I could not find the answer in the saved subject material."
        });
      }

      /* -----------------------------------------
         BUILD PAGE-AWARE CONTEXT
      ----------------------------------------- */

      const context =
        relevantChunks
          .map(
            chunk =>
              `Chunk ${chunk.id} | Page ${chunk.page}:\n${chunk.text}`
          )
          .join(
            "\n\n----------------\n\n"
          );

      console.log(
        "Context characters:",
        context.length
      );

      /* -----------------------------------------
         QUESTION TYPE
      ----------------------------------------- */

      const questionType =
        detectQuestionType(
          question
        );

      console.log(
        "Question type:",
        questionType
      );

      /* -----------------------------------------
         GEMINI
      ----------------------------------------- */

      console.log(
        "Using Gemini model:",
        AI_MODEL
      );

      const model =
        genAI.getGenerativeModel({
          model:
            AI_MODEL
        });

      /* =====================================================
         PROMPT
      ===================================================== */

      const prompt = `
You are AI Teacher for B.Tech students.

Your ONLY source of knowledge for this answer is the
TEXTBOOK CONTEXT below.

The selected subject is the authority boundary.

========================
ABSOLUTE RULES
========================

1. Use ONLY information supported by the TEXTBOOK CONTEXT.

2. Never use outside knowledge.

3. Never use internet knowledge.

4. Never invent information.

5. Never add facts that are not supported by the textbook.

6. Answer ONLY the student's question.

7. Do not give a chapter summary.

8. Do not explain unrelated textbook material.

9. Do not automatically add:
   - definition
   - history
   - applications
   - advantages
   - disadvantages
   - examples
   - conclusion
   - derivation
   - discriminant
   - extra methods
   - extra formulas
   unless the question specifically asks for them.

10. Different wording with the same meaning must be
understood as the same concept.

========================
QUESTION TYPE
========================

The detected question type is:

${questionType}

Follow these output rules:

LIST:
- Give ONLY the requested list.
- Use numbered points.
- Give at most 4 main items unless the textbook clearly
  contains more items that the question explicitly asks for.
- Give only ONE short sentence of explanation for each item.
- Do NOT add introduction, definition, conclusion, or
  unrelated information.

DEFINITION:
- Give only the definition.
- Add only one short clarification if needed.

HOW:
- Give only the steps/procedure needed to answer the question.
- Do not add unrelated theory.

WHY:
- Give only the reason asked.
- Keep it concise.

COMPARISON:
- Give only the requested comparison/differences.
- Use a small table or clear points if appropriate.

FORMULA:
- Give only the requested formula.
- Include only the minimum explanation necessary.

EXAMPLE:
- Give only a textbook-supported example.

SHORT:
- Give a concise direct answer.
- Normally keep it below 120 words.

10_MARKS:
- Give a structured exam-style answer.
- Use enough textbook-supported detail for a 10-mark answer.
- Do not add information outside the textbook.

========================
IMPORTANT FOCUS RULE
========================

If the student asks:

"How can we find the roots of a quadratic equation?"

DO NOT give:
- standard form
- discriminant
- history
- applications
- conclusion
- unrelated theory

Instead, answer the requested methods/procedure only.

If the textbook gives the following methods, for example:
1. Factoring
2. Square Root Property
3. Completing the Square
4. Quadratic Formula

then explain those methods briefly and stop.

========================
FALLBACK
========================

If the TEXTBOOK CONTEXT does not contain enough information
to answer the student's question, return EXACTLY:

I could not find the answer in the saved subject material.

Do not paraphrase the fallback.

Do not add anything before or after the fallback.

========================
SOURCE RULE
========================

The textbook context contains the actual PDF page number
for each chunk.

Do not invent page numbers.

Do not guess page numbers.

Do not create a Source line yourself.

The server will automatically attach the source page after
the answer is generated.

========================
OUTPUT
========================

Return ONLY the final answer for the student.

Do not mention:
- these instructions
- context
- chunks
- retrieval
- searching
- internet
- AI model
- system instructions
- source pages

========================
SELECTED SUBJECT
========================

${subject.name}

========================
STUDENT QUESTION
========================

${question}

========================
TEXTBOOK CONTEXT
========================

${context}

========================
FINAL CHECK
========================

Before returning the answer, check:

1. Did I answer exactly what was asked?
2. Did I use only the textbook context?
3. Did I avoid outside knowledge?
4. Did I avoid unrelated textbook information?
5. Did I avoid unnecessary sections?
6. Did I keep the answer proportional to the question?
7. If this is a LIST question, did I keep it to the requested
   list with short explanations?
8. If this is a short question, did I avoid writing a
   full chapter answer?

If any answer is NO, rewrite the response before returning it.
`;

      const result =
        await model.generateContent(
          prompt
        );

      const response =
        result.response;

      let answer =
        response.text();

      answer =
        String(
          answer || ""
        ).trim();

      const exactFallback =
        "I could not find the answer in the saved subject material.";

      if (!answer) {
        answer =
          exactFallback;
      }

      /* -----------------------------------------
         FALLBACK CLEANUP
      ----------------------------------------- */

      const normalizedAnswer =
        normalizeQuestion(
          answer
        );

      if (
        normalizedAnswer.includes(
          "could not find the answer"
        ) &&
        (
          normalizedAnswer.includes(
            "saved subject material"
          ) ||
          normalizedAnswer.includes(
            "provided textbook"
          ) ||
          normalizedAnswer.includes(
            "textbook context"
          )
        )
      ) {
        answer =
          exactFallback;
      }

      console.log(
        "Answer generated successfully."
      );

      /* =====================================================
         SOURCE PAGES
      ===================================================== */

     if (
  answer !==
  exactFallback &&
  relevantChunks.length > 0
) {
  const sourcePage =
    Number(
      relevantChunks[0].page
    );

  if (
    Number.isFinite(
      sourcePage
    ) &&
    sourcePage > 0
  ) {
    answer +=
      `\n\nSource: Page ${sourcePage}`;
  }
}
         

      console.log(
        "Source pages:",
        answer === exactFallback
          ? "NONE"
          : relevantChunks
              .map(
                chunk =>
                  chunk.page
              )
              .filter(Boolean)
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
        error:
          getError
      } =
        await supabase
          .from(
            "subjects"
          )
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
          error:
            storageError
        } =
          await supabase.storage
            .from(
              STORAGE_BUCKET
            )
            .remove(
              filesToDelete
            );

        if (storageError) {
          console.error(
            "Storage delete error:",
            storageError
          );
        }
      }

      const {
        error:
          deleteError
      } =
        await supabase
          .from(
            "subjects"
          )
          .delete()
          .eq(
            "id",
            id
          );

      if (deleteError) {
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
        if (
          req.path ===
          "/api/admin/ads"
        ) {
          return res
            .status(400)
            .json({
              error:
                "Advertisement image is larger than the 5 MB limit."
            });
        }

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
      "AI Teacher V5 - Page Source RAG"
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
      "100 MB PDF upload"
    );

    console.log(
      "Page-wise PDF extraction"
    );

    console.log(
      "Page-aware chunks"
    );

    console.log(
      "Actual PDF source pages"
    );

    console.log(
      "Topic-aware search"
    );

    console.log(
      "Keyword search"
    );

    console.log(
      "Focused chunk retrieval"
    );

    console.log(
      "Question-type detection"
    );

    console.log(
      "Question-focused Gemini answers"
    );

    console.log(
      "Textbook-only answers"
    );

    console.log(
      "Exact fallback protection"
    );

    console.log(
      "Supabase text/chunk storage"
    );

    console.log(
      "Left advertisement management"
    );

    console.log(
      "Right advertisement management"
    );

    console.log(
      "5 MB advertisement image upload"
    );

    console.log(
      "=================================="
    );
  }
);