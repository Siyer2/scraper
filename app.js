'use strict';

// eslint-disable-next-line import/no-unresolved
const express = require('express');
const axios = require('axios');

const app = express();

//==== Functions ====//
const { parseProgram, parseSpecialisation } = require('./services/handbook');

// Error handler
// app.use((err, req, res) => {
//   console.error(err);
//   res.status(500).send('Internal Serverless Error');
// });

// Middleware
app.use(function (req, res, next) {
  // Load database
  var AWS = require("aws-sdk");
  AWS.config.loadFromPath('./awsKeys.json');
  AWS.config.update({
    region: "ap-southeast-2",
    endpoint: "http:localhost:8000"
  });
  // AWS.config.update({
  // 	region: "ap-southeast-2",
  // 	endpoint: "https://dynamodb.ap-southeast-2.amazonaws.com"
  // });
  var docClient = new AWS.DynamoDB.DocumentClient({
    // accessKeyId: 'AKID',
    endpoint: 'http://localhost:8000',
    // region: 'REGION',
    // secretAccessKey: 'SECRET'
  });
  req.db = docClient;

  next();
});

// Routes
app.get('/me', async (request, response) => {
  let res = await axios.get('http://api.ipify.org');
  let ip = res.data;
  console.log(ip);
  response.send(`Request received: ${request.method} - ${request.path}, ${ip}`);
});

app.get('/specialisation', async function (request, response) {
  try {
    const specialisation = {
      specialisation_code: 'ECONA1',
      specialisation_type: 'major'
    }
    console.log("Parsing ", specialisation);

    const programInfo = {
      year: '2021',
      faculty: '5a3a1d4f4f4d97404aa6eb4f0310c77a',
      title: 'Commerce',
      studyLevel: 'ugrd',
      minimumUOC: '144',
      programCode: '3502'
    }

    await parseSpecialisation(request.db, specialisation, programInfo);

    return response.send(`Parsed ${JSON.stringify(specialisation)}`);
  } catch (error) {
    return response.status(400).json({ error });
  }
});

// Get course requirements for a single program
app.get('/program', async function (request, response) {
  try {
    // const file = require('./3563_2021_cs.json');
    // const pCode = '3154';

    // const year = '2021';
    // const faculty = '5a3a1d4f4f4d97404aa6eb4f0310c77a';
    // const title = 'Actuarial Studies / Science';
    // const studyLevel = 'ugrd';
    // const minimumUOC = '192';
    // const programInfo = { year, faculty, title, studyLevel, minimumUOC, programCode: pCode };
    // await parseProgram(request.db, programInfo, file, year);

    // return response.send("done");

    const programCode = 3154;
    const type = "undergraduate";

    var postData = {
      "query": {
        "bool": {
          "must": [
            {
              "query_string": {
                "query": `unsw_pcourse.code: ${programCode}`
              }
            },
            {
              "term": {
                "live": true
              }
            },
            {
              "bool": {
                "minimum_should_match": "100%",
                "should": [
                  {
                    "query_string": {
                      "fields": [
                        "unsw_pcourse.studyLevelURL"
                      ],
                      "query": type
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      "aggs": {
        "implementationYear": {
          "terms": {
            "field": "unsw_pcourse.implementationYear_dotraw",
            "size": 100
          }
        },
        "availableInYears": {
          "terms": {
            "field": "unsw_pcourse.availableInYears_dotraw",
            "size": 100
          }
        }
      },
      "size": 100,
      "_source": {
        "includes": [
          "versionNumber",
          "availableInYears",
          "implementationYear"
        ]
      }
    }

    var config = {
      method: 'post',
      url: 'https://www.handbook.unsw.edu.au/api/es/search',
      headers: {
        'authority': 'www.handbook.unsw.edu.au',
        'sec-ch-ua': '"Chromium";v="86", ""Not\\A;Brand";v="99", "Google Chrome";v="86"',
        'accept': 'application/json, text/plain, */*',
        'sec-ch-ua-mobile': '?0',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.80 Safari/537.36',
        'content-type': 'application/json;charset=UTF-8',
        'origin': 'https://www.handbook.unsw.edu.au',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://www.handbook.unsw.edu.au/undergraduate/programs/2021/3502?year=2021',
        'accept-language': 'en-US,en;q=0.9',
      },
      data: postData
    };
    axios(config) // HERE
      .then(async function (res) {
        let programPromises = res.data.contentlets.map((currentYear) => {
          return new Promise(async (resolve, reject) => {
            try {
              const year = JSON.parse(currentYear.data).implementation_year;
              const faculty = JSON.parse(currentYear.data).parent_academic_org.cl_id || JSON.parse(currentYear.data).owning_org.cl_id;
              const title = JSON.parse(currentYear.data).title;
              const studyLevel = JSON.parse(currentYear.data).study_level_single.value;
              const minimumUOC = JSON.parse(currentYear.data).credit_points;
              const programInfo = { year, faculty, title, studyLevel, minimumUOC, programCode };

              await parseProgram(request.db, programInfo, JSON.parse(currentYear.CurriculumStructure));

              resolve();
            } catch (ex) {
              console.log("EXCEPTION PARSING PROGRAM", ex);
              reject(ex);
            }
          });
        });

        await Promise.all(programPromises);

        return response.send(`Finished parsing ${programCode}...`);
      })
      .catch(function (error) {
        console.log("AXIOS ERROR PARSING PROGRAM", error.response.status);
        return response.status(400).json({ error });
      });
  } catch (error) {
    return response.status(400).json({ error });
  }
});

module.exports = app;
