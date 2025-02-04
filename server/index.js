require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 5000;
const app = express();

const corsOption = {
  origin: ["http://localhost:5173"],
  credentials: true,
  optionalSuccessStatus: 200,
};

app.use(cors(corsOption));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bmcuq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// verify token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  //console.log(token);
  if (!token) return res.status(401).send({ message: "unauthorized access" });
  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).send({ message: "unauthorized access" });
    req.user = decoded;
  });
  next();
};

async function run() {
  try {
    const db = client.db("solo-db");
    const jobsCollection = db.collection("jobs");
    const bidsCollection = db.collection("bids");

    // generate jwt(json web token)
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      //crete token
      const token = jwt.sign(email, process.env.SECRET_KEY, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // logout || clear cookie from browser
    app.get("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // add job, save a job data in db
    app.post("/add-job", async (req, res) => {
      const jobData = req.body;
      const result = await jobsCollection.insertOne(jobData);
      res.send(result);
    });

    // get all jobs data from database(show home page)
    app.get("/jobs", async (req, res) => {
      const result = await jobsCollection.find().toArray();
      res.send(result);
    });

    // get all jobs posted by a specific user
    app.get("/jobs/:email", async (req, res) => {
      const email = req.params.email;
      const query = { "buyer.email": email };
      const result = await jobsCollection.find(query).toArray();
      res.send(result);
    });

    // delete a posted job from db
    app.delete("/job-delete/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.deleteOne(query);
      res.send(result);
    });

    // get a single job data by id from db
    app.get("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.findOne(query);
      res.send(result);
    });

    // updated (posted job)
    app.put("/update-job/:id", async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const updated = {
        $set: data,
      };
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const result = await jobsCollection.updateOne(query, updated, options);
      res.send(result);
    });

    // place bid post in database
    app.post("/add-bid", async (req, res) => {
      const bidData = req.body;
      // if a user placed a bid already in this job(same gmail die same job ke ekbare basi bid kora jabe na
      const query = { email: bidData.email, jobId: bidData.jobId };
      const alreadyExist = await bidsCollection.findOne(query);
      if (alreadyExist) {
        return res
          .status(400)
          .send("You have already placed a bid on this job");
      }
      // 1. save data in bids collection
      const result = bidsCollection.insertOne(bidData);
      // 2. increase bid count in jobs collection
      const filter = { _id: new ObjectId(bidData.jobId) };
      const update = {
        $inc: { bid_count: 1 },
      };
      const updateBidCount = await jobsCollection.updateOne(filter, update);

      res.send(result);
    });

    //get all bids & bid request for a specific user &
    app.get("/bids/:email", verifyToken, async (req, res) => {
      const decodedEmail = req.user?.email;
      const isBuyer = req.query.buyer;
      const email = req.params.email;
      // verify token
      if (decodedEmail !== email) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      //
      let query = {};
      if (isBuyer) {
        query.buyer = email;
      } else {
        query.email = email;
      }
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });

    /*  //get all bids for a specific user & 
    app.get("/bids/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });
    // get all bid request for a specific user
    app.get("/bid-request/:email", async (req, res) => {
      const email = req.params.email;
      const query = { buyer: email };
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });  */

    // updated bids status
    app.patch("/bid-status-updated/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updated = {
        $set: { status: status },
      };
      const result = await bidsCollection.updateOne(filter, updated);
      res.send(result);
    });

    // get all jobs
    app.get("/all-jobs", async (req, res) => {
      // filter by category
      /* const filter = req.query.filter;
      let query = {};
      if (filter) query.category = filter; */

      // filter & search function
      const filter = req.query.filter;
      const search = req.query.search;
      const sort = req.query.sort;
      // sort
      let options = {};
      if (sort) options = { sort: { deadline: sort === "asc" ? 1 : -1 } };
      // search
      let query = {
        title: {
          $regex: search,
          $options: "i",
        },
      };
      // filter
      if (filter) query.category = filter;
      //
      const result = await jobsCollection.find(query, options).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello from SoloSphere Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
