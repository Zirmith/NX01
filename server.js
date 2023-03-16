const express = require("express");
const app = express();
const cors = require("cors");
app.use(cors());
app.use(express.json());


const session = require("express-session");
const getmac = require("getmac");
const errorHandler = require("express-error-handler");
const { logger } = require("./logging");
const port = process.env.PORT || 3000;
var mineflayer = require("mineflayer");

require('dotenv').config()


const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = "https://paradox-utilities.onrender.com/paradox/v1/oauth2/authorize";

const api_settings = {
  allow_access_by_default: true,
  api_key_prefix: "paradox-",
  api_max_day_usage: 30,
  api_rate_limit: 1000,

  api_sources: [
    {
      name: "Paradox",
      url: "https://paradox-utilities.onrender.com/paradox/v1/login",
    },
  ],
};

// Store the users in an array
const users = [];
const cache = {};

const uuid = require("uuid");

app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

const axios = require("axios");

async function validateApiKey(apiKey) {
  const hwid = getmac.default();

  try {
    const userData = users.find((user) => user.apiKey === apiKey);

    if (!userData) {
      throw new Error("API key not found");
    }

    if (userData.hwid !== hwid) {
      throw new Error("Invalid API key");
    }

    // Check rate limiting
    const lastUsage = userData.lastUsage || 0;
    const timeSinceLastUsage = Date.now() - lastUsage;
    const timeToWait = Math.max(
      0,
      1000 / api_settings.api_rate_limit - timeSinceLastUsage
    );

    if (timeToWait > 0) {
      throw new Error(
        `API key rate limit exceeded. Please wait ${Math.ceil(
          timeToWait / 1000
        )} seconds before making another request.`
      );
    }

    // Check if the API key has already reached the daily usage limit
    const currentUsage = userData.usage;
    if (currentUsage >= api_settings.api_max_day_usage) {
      const now = new Date();
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        0
      );

      // Set the expiry time of the API key to the end of the day
      userData.expiry = endOfDay;

      throw new Error("API key usage limit exceeded for the day");
    }

    // Check if the API key has expired
    if (userData.expiry && userData.expiry < new Date()) {
      throw new Error("API key has expired");
    }

    // Check if the key has been deactivated
    if (userData.activationStatus === "Deactivated") {
      throw new Error("API key deactivated");
    }

    // Increase the usage value of the API key
    const newUsageValue = currentUsage + 1;
    // Update the usage value and last usage time of the API key
    userData.usage = newUsageValue;
    userData.lastUsage = Date.now();
    return userData;
  } catch (error) {
    throw error;
  }
}

app.get("/", (req,res) => {
    res.json({Message:"You Fool", Config: api_settings})
})

app.get("/paradox/v1/example", async (req, res) => {
    try {
      const apiKey = req.query.api_key;
      const isValid = await validateApiKey(apiKey);
  
      if (!isValid) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }
  
      // Handle the request
      res.json({ message: "Success!" });
    } catch (error) {
      console.error(error);
      const errorMessage =
        error.message === "API key has expired"
          ? "API key has invalidated for today"
          : "Internal Server Error";
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get("/paradox/v1/example-list", async (req, res) => {
    try {
      const apiKey = req.query.api_key;
      const isValid = await validateApiKey(apiKey);
  
      if (!isValid) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }
  
      const exampleData = [
        { id: 1, name: "Example 1", value: 10 },
        { id: 2, name: "Example 2", value: 20 },
        { id: 3, name: "Example 3", value: 30 },
        { id: 4, name: "Example 4", value: 40 },
      ];
  
      res.json(exampleData);
    } catch (error) {
      console.error(error);
      const errorMessage =
        error.message === "API key has expired"
          ? "API key has invalidated for today"
          : "Internal Server Error";
      res.status(500).json({ error: errorMessage });
    }
  });
  
  // Middleware function to check login status
  const checkLogin = (req, res, next) => {
    if (!req.session.loginStatus) {
      res.redirect("/paradox/v1/login");
    } else {
      next();
    }
  };

  app.get("/paradox/v1/login", (req, res) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify`;
    res.redirect(authUrl);
  });

  app.get("/paradox/v1/oauth2/authorize", async (req, res) => {
    const { code } = req.query;
    logger.info(`Received code:  ${code}`);
    try {
      const { data } = await axios({
        method: "POST",
        url: "https://discord.com/api/oauth2/token",
        data: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
  
      const { access_token } = data;
  
      // Use the access token to make API requests on behalf of the user
      console.log(access_token);
      const { data: user } = await axios({
        method: "GET",
        url: "https://discord.com/api/users/@me",
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
        params: {
          fields: "id",
        },
      });
  
      // Generate a random API key
      const hwid = getmac.default();
  
      // Check if a user already exists with the same hardware ID
      const existingUserIndex = users.findIndex((u) => u.id === user.id);
  
      if (existingUserIndex !== -1) {
        const existingUser = users[existingUserIndex];
        // User with the same hardware ID already exists
        if (existingUser.loginStatus === "loggedIn") {
          // User is already logged in, return existing API key
          //res.json({ apiKey: existingUser.apiKey });
          res.redirect('/');
          return;
        }
  
        // User is not logged in, update loginStatus and continue
        existingUser.loginStatus = "loggedIn";
      } else {
        // User does not exist, create new user object
        const apiKey = uuid.v4();
        const newUser = {
          id: user.id,
          username: user.username,
          apiKey: api_settings.api_key_prefix + apiKey,
          hwid: hwid,
          usage: 0,
          lastUsage: 0,
          max_uses: api_settings.api_max_day_usage,
          discord_api: access_token,
          activationStatus: "Active",
          loginStatus: "loggedIn",
        };
  
        // Add user object to the users array
        users.push(newUser);
  
        // Store the API key in cache
        cache[hwid] = apiKey;
      }
  
      // Store user in session
      req.session.user = user;
      logger.info(`Logged in as ${user.username}`);
      setTimeout(() => {
        res.redirect("/paradox/v1/mykey");
      }, 1000);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
      logger.error(error);
    }
  });

  app.get('/paradox/v1/mykey', async (req, res) =>{
    // Checking if req.session.user exists before destructuring it
    const user = req.session.user || {};
  
    if (!user || !user.id) {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      const hwid = getmac.default();
  
      try {
        // Delete any duplicate users with the same HWID
        const idx = users.findIndex((u) => u.hwid === hwid && u.id !== user.id);
        if (idx !== -1) {
          users.splice(idx, 1);
        }
  
        const userData = users.find((u) => u.hwid === hwid); // Retrieve user data from users array
        if (userData && userData.username) {
          logger.info(`Got Info For -> ${userData.username}`);
        } else {
          logger.info(`Could not find username for ${hwid}`);
        }
  
        if (!userData || userData.id !== user.id) {
          res.status(404).json({ error: "API key not found" });
          logger.error("API key not found");
        } else {
          res.json({api_key: userData.apiKey });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
        logger.error(error);
      }
    }
  })

  app.get("/paradox/v1/me", async (req, res) => {
    // Checking if req.session.user exists before destructuring it
    const user = req.session.user || {};
  
    if (!user || !user.id) {
      res.status(401).json({ error: "Unauthorized" });
    } else {
      const hwid = getmac.default();
  
      try {
        // Delete any duplicate users with the same HWID
        const idx = users.findIndex((u) => u.hwid === hwid && u.id !== user.id);
        if (idx !== -1) {
          users.splice(idx, 1);
        }
  
        const userData = users.find((u) => u.hwid === hwid); // Retrieve user data from users array
        if (userData && userData.username) {
          logger.info(`Got Info For -> ${userData.username}`);
        } else {
          logger.info(`Could not find username for ${hwid}`);
        }
  
        if (!userData || userData.id !== user.id) {
          res.status(404).json({ error: "API key not found" });
          logger.error("API key not found");
        } else {
          const apiKey = cache[hwid];
          res.json({ userData });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
        logger.error(error);
      }
    }
  });


  app.get('/paradox/v1/minecraft/create', async (req, res) => {
    try {
      const apiKey = req.query.api_key;
      console.log(apiKey)
      const host1 = req.query.host
      const port1 = req.query.port
      const username1 = req.query.username
      const password1 = req.query.password
      
      const isValid = await validateApiKey(apiKey)
      if (!isValid) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }
      
      const bot = mineflayer.createBot({
        host: host1 || 'localhost',
        port: port1 || 25565,
        username: username1 || "Paradox-" + Math.floor(Math.random(0,100)),
        password: password1 || Math.floor(Math.random(0,100)) + "applepie",
        
      }).on("end", () => {
        console.log('whoops')
      })
  
      bot.on('error', (err) => {
        console.error(err)
      })
      bot.on("death", () => {
        bot.on("respawn", () => {
          console.log('done')
        })
      })
     
      bot.on('spawn', () => {
        bot.on("death", () => {
          console.log("Dead")
          return 
        })
        res.json({ message: "Bot spawned successfully" })
      })
    } catch (err) {
      console.error(err);
      const errorMessage =
        error.message === "API key has expired"
          ? "API key has invalidated for today"
          : "Internal Server Error";
      res.status(500).json({ error: errorMessage });
    }
  })

  // Set up error handling
  app.use(
    errorHandler({
      log: ({ level, message, error }, _err, _req, _res) => {
        logger.log(level, message, { error });
      },
    })
  );
  
  app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
  });