require('dotenv').config();
const Fastify = require('fastify');
const fastify = Fastify({
  bodyLimit: 20971520 // 20MB
});
const mongo = require("mongodb").MongoClient;
let coll;

// mongodb setup
mongo.connect(
  process.env.MONGO_AUTH, (err, client) => {
    if (err) {
      console.error(err);
      return;
    };
    let db = client.db("sb-slash");
    coll = db.collection("sbml");
  }
)
// prehook
fastify.addHook('preValidation', (req, reply, done) => {
  if (req.query.auth !== process.env.AUTH) {
    reply.code(403);
    done(new Error("Not authorized"));
  }
  done();
})
// get
fastify.all('/get', async (req, reply) => {
  if (req.query.video_id) {
    const result = await coll.findOne({
      video_id: req.query.video_id
    });
    reply.send(result);
  }
  const cursor = await coll.aggregate([
    { $match: { type: "missed" }},
    { $sample: { size: 1 }}
  ]);
  const results = await cursor.toArray();
  if (results.length === 0) return reply.code(404).send();
  reply.send(results[0]);
});
// done
fastify.all('/done', async (req, reply) => {
  const result = await coll.updateOne(
    { video_id: req.query.video_id },
    [{ $set: { type: "done" }},
      { $unset: "missed" }
    ]
  );
  return reply.send(result);
})
// reject
fastify.all('/reject', async (req, reply) => {
  const result = await coll.updateOne(
    { video_id: req.query.video_id },
    { $set: { type: "rejected" } }
  );
  return reply.send(result);
})
// loading
fastify.all('/load', async (req, reply) => {
  const bulk = coll.initializeUnorderedBulkOp()
  const suggestArray = req.body.split('\n');
  // try parse json
  let jsonerror = 0;
  for (const suggest of suggestArray) {
    try {
      const result = JSON.parse(suggest);
      bulk.insert({...result, type: result?.missed?.length ? "missed" : "incorrect"});
    } catch (err) {
      console.log(err.name);
      jsonerror++;
    }
  }
  // execute
  let bulkResponse;
  try {
    const rawResponse = await bulk.execute();
    bulkResponse = { ok: rawResponse.ok, inserted: rawResponse.nInserted, jsonErrors: jsonerror };
  } catch (err) {
    console.log(err)
    if (err?.result?.result) {
      const rawResponse = err.result.result
      bulkResponse = { ok: rawResponse.ok, code: err.code, inserted: rawResponse.nInserted, jsonErrors: jsonerror, writeErrors: rawResponse.writeErrors?.length };
    } else {
      bulkResponse = { ok: false, code: err.code, jsonErrors: jsonerror };
    }
  }
  reply.send({ ...bulkResponse, input: suggestArray.length });
})
fastify.all("*", (req, reply) => {
  reply.status(404).send();
})

fastify.listen(process.env.PORT);