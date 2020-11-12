'use strict';

// eslint-disable-next-line import/no-unresolved
require('dotenv').config()
const express = require('express');
const axios = require('axios');
const _ = require('lodash');
var AWS = require("aws-sdk");

const app = express();

//==== Functions ====//
const { parseProgram } = require('./services/handbook');
const { getProgramInfo } = require('./services/helperFunctions');
const { backOff } = require('exponential-backoff');

// Error handler
// app.use((err, req, res) => {
//   console.error(err);
//   res.status(500).send('Internal Serverless Error');
// });

// Middleware
app.use(function (req, res, next) {
	// Load database
	AWS.config.loadFromPath('./awsKeys.json');

	var docClient;
	if (process.env.DEPLOYMENT === 'production') {
		AWS.config.update({
			region: "ap-southeast-2",
			endpoint: "https://dynamodb.ap-southeast-2.amazonaws.com", 
		});
	}
	else {
		AWS.config.update({
			region: "ap-southeast-2",
			endpoint: "http://localhost:8000"
		});
	}

	var docClient = new AWS.DynamoDB.DocumentClient();
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

// SPECIALISATION COMMANDS
//#region
app.get('/specialisation', async function (request, response) {
	try {
		// Get all specialisations
		var postData = {
			"query": {
				"bool": {
					"must": [
						{
							"term": {
								"live": true
							}
						},
						[
							{
							    "bool": {
							        "minimum_should_match": "100%",
							        "should": [
							            {
							                "query_string": {
							                    "fields": [
							                        "unsw_paos.implementationYear"
							                    ],
							                    "query": "*2021*"
							                }
							            }
							        ]
							    }
							},
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_paos.studyLevelValue"
												],
												"query": "*rsch*"
											}
										}
									]
								}
							},
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_paos.active"
												],
												"query": "*1*"
											}
										}
									]
								}
							}
						]
					],
					"filter": [
						{
							"terms": {
								"contenttype": [
									"unsw_paos"
								]
							}
						}
					]
				}
			},
			"sort": [
				{
					"unsw_paos.code_dotraw": {
						"order": "asc"
					}
				}
			],
			"from": 0,
			"size": 1000,
			"track_scores": true,
			"_source": {
				"includes": [
					"*.code",
					"*.name",
					"*.award_titles",
					"*.keywords",
					"urlmap",
					"contenttype"
				],
				"excludes": [
					"",
					null
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
		axios(config)
			.then(async function (res) {
				let programPromises = res.data.contentlets.map((currentYear) => {
					return new Promise(async (resolve, reject) => {
						try {
							const programInfo = getProgramInfo(JSON.parse(currentYear.data));

							await parseProgram(request.db, programInfo, JSON.parse(currentYear.CurriculumStructure), {
								specialisation_code: programInfo.programCode,
								specialisation_type: programInfo.specialisation_type,
								implementation_year: programInfo.year
							});

							resolve();
						} catch (ex) {
							console.log("EXCEPTION PARSING PROGRAM", ex);
							reject(ex);
						}
					});
				});

				await Promise.all(programPromises);

				return response.send(`Successfully pushed ${res.data.contentlets.length} specialisations`);
			})
			.catch(function (error) {
				console.log("AXIOS ERROR PARSING PROGRAM", error.response.status);
				return response.status(400).json({ error });
			});

	} catch (error) {
		return response.status(400).json({ error });
	}
});

app.get('/multipleSpecs', async function (request, response) {
	try {
		const specCodes = [
			'MODLES', 
			'MUSCAS', 
			'PHILAS', 
			'POLSES', 
			'SLSPAS', 
			'SOCAAS', 
			'SOCWAS'
		];
		const year = '2021';
		const studyLevel = 'postgraduate';

		const specPromises = specCodes.map((specCode) => {
			return new Promise(async (resolve, reject) => {
				try {
					var postData = {
						"query": {
							"bool": {
								"must": [
									{
										"query_string": {
											"query": `unsw_paos.code: ${specCode}`
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
															"unsw_paos.studyLevelURL"
														],
														"query": studyLevel
													}
												}
											]
										}
									},
									{
										"bool": {
											"minimum_should_match": "100%",
											"should": [
												{
													"query_string": {
														"fields": [
															"unsw_paos.implementationYear"
														],
														"query": `*${year}*`
													}
												}
											]
										}
									},
								]
							}
						},
						"aggs": {
							"implementationYear": {
								"terms": {
									"field": "unsw_paos.implementationYear_dotraw",
									"size": 100
								}
							},
							"availableInYears": {
								"terms": {
									"field": "unsw_paos.availableInYears_dotraw",
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
					axios(config)
						.then(async function (res) {
							let programPromises = res.data.contentlets.map((currentYear) => {
								return new Promise(async (resolve, reject) => {
									try {
										const programInfo = getProgramInfo(JSON.parse(currentYear.data));

										await parseProgram(request.db, programInfo, JSON.parse(currentYear.CurriculumStructure), {
											specialisation_code: programInfo.programCode,
											specialisation_type: programInfo.specialisation_type,
											implementation_year: programInfo.year
										});

										resolve();
									} catch (ex) {
										console.log("EXCEPTION PARSING PROGRAM", ex);
										reject(ex);
									}
								});
							});

							await Promise.all(programPromises);

							resolve();
						})
						.catch(function (error) {
							console.log("AXIOS ERROR PARSING PROGRAM", error);
							return response.status(400).json({ error });
						});
				} catch (ex) {
					console.log("EXCEPTION WITH SPECCODES", ex);
					reject(ex);
				}
			});
		});

		await Promise.all(specPromises);
		return response.send('done');
	} catch (error) {
		return response.status(400).json({ error });
	}
});

app.get('/individualSpec', async function (request, response) {
	try {
		const specCode = 'RUSSAR';
		const year = '2019';
		const studyLevel = 'rsch';

		var postData = {
			"query": {
				"bool": {
					"must": [
						{
							"query_string": {
								"query": `unsw_paos.code: ${specCode}`
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
												"unsw_paos.studyLevelURL"
											],
											"query": studyLevel
										}
									}
								]
							}
						}, 
						{
							"bool": {
								"minimum_should_match": "100%",
								"should": [
									{
										"query_string": {
											"fields": [
												"unsw_paos.implementationYear"
											],
											"query": `*${year}*`
										}
									}
								]
							}
						},
					]
				}
			},
			"aggs": {
				"implementationYear": {
					"terms": {
						"field": "unsw_paos.implementationYear_dotraw",
						"size": 100
					}
				},
				"availableInYears": {
					"terms": {
						"field": "unsw_paos.availableInYears_dotraw",
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
		axios(config)
			.then(async function (res) {
				let programPromises = res.data.contentlets.map((currentYear) => {
					return new Promise(async (resolve, reject) => {
						try {
							const programInfo = getProgramInfo(JSON.parse(currentYear.data));

							await parseProgram(request.db, programInfo, JSON.parse(currentYear.CurriculumStructure), {
								specialisation_code: programInfo.programCode,
								specialisation_type: programInfo.specialisation_type,
								implementation_year: programInfo.year
							});

							resolve();
						} catch (ex) {
							console.log("EXCEPTION PARSING PROGRAM", ex);
							reject(ex);
						}
					});
				});

				await Promise.all(programPromises);

				return response.send(`Successfully pushed ${res.data.contentlets.length} specialisation`);
			})
			.catch(function (error) {
				console.log("AXIOS ERROR PARSING PROGRAM", error);
				return response.status(400).json({ error });
			});
	} catch (error) {
		return response.status(400).json({ error });
	}
});
//#endregion

// PROGRAM COMMANDS
//#region
app.get('/multiplePrograms', async function (request, response) {
	try {
		const programCodes = ["1120",
			"1271",
			"1272",
			"1273",
			"1835",
			"2267",
			"2364",
			"2585",
			"2645"]
		const year = '2021';
		const studyLevel = 'rsch';

		const programPromises = programCodes.map((programCode) => {
			return new Promise(async (resolve, reject) => {
				try {
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
									[
										{
											"bool": {
												"minimum_should_match": "100%",
												"should": [
													{
														"query_string": {
															"fields": [
																"unsw_pcourse.studyLevelValue"
															],
															"query": `*${studyLevel}*`
														}
													}
												]
											}
										},
										{
											"bool": {
												"minimum_should_match": "100%",
												"should": [
													{
														"query_string": {
															"fields": [
																"unsw_pcourse.implementationYear"
															],
															"query": `*${year}*`
														}
													}
												]
											}
										},
										{
											"bool": {
												"minimum_should_match": "100%",
												"should": [
													{
														"query_string": {
															"fields": [
																"unsw_pcourse.active"
															],
															"query": "*1*"
														}
													}
												]
											}
										}
									]
								],
								"filter": [
									{
										"terms": {
											"contenttype": [
												"unsw_pcourse",
												"unsw_pcourse"
											]
										}
									}
								]
							}
						},
						"sort": [
							{
								"unsw_pcourse.code_dotraw": {
									"order": "asc"
								}
							}
						],
						"from": 0,
						"size": 1000,
						"track_scores": true,
						"_source": {
							"includes": [
								"*.code",
								"*.name",
								"*.award_titles",
								"*.keywords",
								"urlmap",
								"contenttype"
							],
							"excludes": [
								"",
								null
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
					axios(config)
						.then(async function (res) {
							let programPromises = res.data.contentlets.map((currentYear) => {
								return new Promise(async (resolve, reject) => {
									try {
										const programInfo = getProgramInfo(JSON.parse(currentYear.data));

										await parseProgram(request.db, programInfo, JSON.parse(currentYear.CurriculumStructure));

										resolve();
									} catch (ex) {
										console.log("EXCEPTION PARSING PROGRAM", ex);
										reject(ex);
									}
								});
							});

							await Promise.all(programPromises);

							resolve();
						})
						.catch(function (error) {
							console.log("AXIOS ERROR PARSING PROGRAM", error);
							return response.status(400).json({ error });
						});
				} catch (ex) {
					console.log("EXCEPTION WITH SPECCODES", ex);
					reject(ex);
				}
			});
		});

		await Promise.all(programPromises);
		return response.send('done');
	} catch (error) {
		return response.status(400).json({ error });
	}
});

app.get('/program', async function (request, response) {
	try {
		// Get all programs
		var postData = {
			"query": {
				"bool": {
					"must": [
						{
							"term": {
								"live": true
							}
						},
						[
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_pcourse.studyLevelValue"
												],
												"query": "*rsch*"
											}
										}
									]
								}
							},
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_pcourse.implementationYear"
												],
												"query": "*2021*"
											}
										}
									]
								}
							},
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_pcourse.active"
												],
												"query": "*1*"
											}
										}
									]
								}
							}
						]
					],
					"filter": [
						{
							"terms": {
								"contenttype": [
									"unsw_pcourse",
									"unsw_pcourse"
								]
							}
						}
					]
				}
			},
			"sort": [
				{
					"unsw_pcourse.code_dotraw": {
						"order": "asc"
					}
				}
			],
			"from": 0,
			"size": 500,
			"track_scores": true,
			"_source": {
				"includes": [
					"*.code",
					"*.name",
					"*.award_titles",
					"*.keywords",
					"urlmap",
					"contenttype"
				],
				"excludes": [
					"",
					null
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
		axios(config)
			.then(async function (res) {
				let programPromises = res.data.contentlets.map((currentYear) => {
					return new Promise(async (resolve, reject) => {
						try {
							const programInfo = getProgramInfo(JSON.parse(currentYear.data));

							await parseProgram(request.db, programInfo, JSON.parse(currentYear.CurriculumStructure));

							resolve();
						} catch (ex) {
							console.log("EXCEPTION PARSING PROGRAM", ex);
							reject(ex);
						}
					});
				});

				await Promise.all(programPromises);

				return response.send(`Successfully pushed ${res.data.contentlets.length} programs`);
			})
			.catch(function (error) {
				console.log("AXIOS ERROR PARSING PROGRAM", error.response.status);
				return response.status(400).json({ error });
			});
	} catch (error) {
		return response.status(400).json({ error });
	}
});
//#endregion

// COURSE COMMANDS
//#region
function batchAndUploadCourses(db, courses) {
	return new Promise(async (resolve, reject) => {
		try {
			// Split into arrays of length 25 each
			const chunkedCourses = _.chunk(courses, 25);

			// Push to DB
			var unprocessedItems = [];
			const pushPromises = chunkedCourses.map((chunk) => {
				return new Promise(async (resolve, reject) => {
					try {
						const params = {
							RequestItems: {
								courses: chunk
							}
						};

						db.batchWrite(params, function (err, data) {
							if (err) {
								console.log("AWS ERROR BATCH WRITING COURSES", err);
								reject(err);
							}
							else {
								// console.log(`Successfully pushed ${chunk.length} courses!`);
								if (data.UnprocessedItems.courses) {
									unprocessedItems = unprocessedItems.concat(data.UnprocessedItems.courses);
								}
								resolve();
							}
						});
					} catch (ex) {
						console.log("EXCEPTION WITH PUSHPROMISES", ex);
						reject(ex);
					}
				});
			});
			await Promise.all(pushPromises);

			if (unprocessedItems.length) {
				console.log(`Retrying ${unprocessedItems.length} unprocessed`);
				await backOff(() => batchAndUploadCourses(db, unprocessedItems));
			}

			resolve();
		} catch (ex) {
			console.log("EXCEPTION BATCHING AND UPLOADING COURSES", ex);
			reject(ex);
		}
	});
}

// Store all courses
app.get('/courses', async function (request, response) {
	try {
		// Get all courses
		var postData = {
			"query": {
				"bool": {
					"must": [
						{
							"term": {
								"live": true
							}
						},
						[
							// {
							//     "bool": {
							//         "minimum_should_match": "100%",
							//         "should": [
							//             {
							//                 "query_string": {
							//                     "fields": [
							//                         "unsw_psubject.implementationYear"
							//                     ],
							//                     "query": "*2021*"
							//                 }
							//             }
							//         ]
							//     }
							// },
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_psubject.studyLevelValue"
												],
												"query": "*rsch*"
											}
										}
									]
								}
							},
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_psubject.active"
												],
												"query": "*1*"
											}
										}
									]
								}
							}
						]
					],
					"filter": [
						{
							"terms": {
								"contenttype": [
									"unsw_psubject"
								]
							}
						}
					]
				}
			},
			"sort": [
				{
					"unsw_psubject.code_dotraw": {
						"order": "asc"
					}
				}
			],
			"from": 0,
			"size": 10000,
			"track_scores": true,
			"_source": {
				"includes": [
					"*.code",
					"*.name",
					"*.award_titles",
					"*.keywords",
					"urlmap",
					"contenttype"
				],
				"excludes": [
					"",
					null
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
		const res = await axios.request(config);

		// Format into array ready for batch write
		const formattedCourses = res.data.contentlets.map((course) => {
			return {
				"PutRequest": {
					"Item": {
						course_code: course.code,
						implementation_year: course.implementationYear,
						credit_points: course.creditPoints,
						link: course.urlMap, 
						name: course.title
					}
				}
			}
		});
		
		await batchAndUploadCourses(request.db, formattedCourses);
		
		return response.send(`Successfully pushed ${res.data.contentlets.length} courses`);
	} catch (error) {
		return response.status(400).json({ error });
	}
});
//#endregion

//==== Calls to initialise the Dynamo DB ====//
app.get('/db', async function (request, response) {
	try {
		var dynamodb = new AWS.DynamoDB();

		//#region START DYNAMODB COMMANDS

		// Updating an item
		// Get all programs
		const size = 10000;
		const year = '2021';
		const studyLevel = 'rsch';
		var postData = {
			"query": {
				"bool": {
					"must": [
						{
							"term": {
								"live": true
							}
						},
						[
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_paos.implementationYear"
												],
												"query": `*${year}*`
											}
										}
									]
								}
							},
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_paos.studyLevelValue"
												],
												"query": `*${studyLevel}*`
											}
										}
									]
								}
							},
							{
								"bool": {
									"minimum_should_match": "100%",
									"should": [
										{
											"query_string": {
												"fields": [
													"unsw_paos.active"
												],
												"query": "*1*"
											}
										}
									]
								}
							}
						]
					],
					"filter": [
						{
							"terms": {
								"contenttype": [
									"unsw_paos"
								]
							}
						}
					]
				}
			},
			"sort": [
				{
					"unsw_paos.code_dotraw": {
						"order": "asc"
					}
				}
			],
			"from": 0,
			"size": size,
			"track_scores": true,
			"_source": {
				"includes": [
					"*.code",
					"*.name",
					"*.award_titles",
					"*.keywords",
					"urlmap",
					"contenttype"
				],
				"excludes": [
					"*.data",
					"*.CurriculumStructure",
					null
				]
			}
		};
		var config = {
			method: 'post',
			url: 'https://www.handbook.unsw.edu.au/api/es/search',
			headers: {
				'authority': 'www.handbook.unsw.edu.au',
				'sec-ch-ua': '"Chromium";v="86", ""Not\\A;Brand";v="99", "Google Chrome";v="86"',
				'accept': 'application/json, text/plain, */*',
				'sec-ch-ua-mobile': '?0',
				'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.111 Safari/537.36',
				'content-type': 'application/json;charset=UTF-8',
				'origin': 'https://www.handbook.unsw.edu.au',
				'sec-fetch-site': 'same-origin',
				'sec-fetch-mode': 'cors',
				'sec-fetch-dest': 'empty',
				'referer': 'https://www.handbook.unsw.edu.au/search',
				'accept-language': 'en-US,en;q=0.9',
				'cookie': '_ga=GA1.3.388150395.1453595676; intercom-id-aljrgok4=d2db6e94-92b9-4e86-9f0e-7ea289ddf7f8; dmid=e5ad2759-de10-43d9-9680-1adce751f92b; __zlcmid=zSjK8BIRHV5kAR; lbsid=PFA_VjhpYoTB7CcIzr9S-yBN02dyO07-6Rs8IHlTpBQEhVmU7kT-u0021-432854652u00211603085416553; opvc=45d3c05c-3e8d-4f7d-a296-418604425616; sitevisitscookie=4; at_check=true; AMCVS_8A5564D65437E5950A4C98A2%40AdobeOrg=1; AMCV_8A5564D65437E5950A4C98A2%40AdobeOrg=870038026%7CMCIDTS%7C18562%7CMCMID%7C63746417553964156775305656083527895225%7CMCAID%7CNONE%7CMCOPTOUT-1603680153s%7CNONE%7CvVersion%7C5.0.0; JSESSIONID=89F903A5D8BA65C473A8A467E36BD561; AWSALB=l377qq+1jEMtcH6nmW/rkndyegj+NIMbqO9X7LGd3q7sKeicab+uzSdrRkpVy7O0UOWyLuZuPrw8ouPAM5oB8Jp93TB8LHgTIVkqduvw5p/3ThlgquWgBIC1R0pa; AWSALBCORS=l377qq+1jEMtcH6nmW/rkndyegj+NIMbqO9X7LGd3q7sKeicab+uzSdrRkpVy7O0UOWyLuZuPrw8ouPAM5oB8Jp93TB8LHgTIVkqduvw5p/3ThlgquWgBIC1R0pa; AWSALB=OvSyNLZJo5xGby2Xsge+3Hyal+q2ItAOPu9hD2VbuQE47rjJbUUR+49B2jZDh6iftXFntO4a1npHp+0SGNm/nzSjtmfcmL9NLJKbdPeW3jjqs8iUfmoPqbSNfi91; AWSALBCORS=OvSyNLZJo5xGby2Xsge+3Hyal+q2ItAOPu9hD2VbuQE47rjJbUUR+49B2jZDh6iftXFntO4a1npHp+0SGNm/nzSjtmfcmL9NLJKbdPeW3jjqs8iUfmoPqbSNfi91; JSESSIONID=96AD3F4FF8A91DE41BF255A24899A89F'
			},
			data: postData
		};
		axios(config)
			.then(async function (response) {
				console.log(`Found ${response.data.contentlets.length} specialisations`);
				const specPromises = response.data.contentlets.map((spec) => {
					return new Promise(async (resolve, reject) => {
						var params = {
							TableName: 'specialisations',
							Key: {
								specialisation_code: spec.code,
								implementation_year: spec.implementationYear
							},
							UpdateExpression: 'SET title = :value',
							ExpressionAttributeValues: {
								':value': spec.title
							},
							ReturnValues: 'ALL_NEW'
						};

						request.db.update(params, function (err, data) {
							if (err) {
								console.log(err);
								reject(err);
							}
							else {
								console.log(data);
								resolve();
							}
						});
					})
				});

				await Promise.all(specPromises);
			})
			.catch(function (error) {
				console.log(error);
			});

		//#endregion

		return response.send("done");
	} catch (error) {
		return response.status(400).json({ error });
	}
});

module.exports = app;
