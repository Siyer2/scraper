const axios = require('axios');
const _ = require('lodash');

//==== Helper functions ====//
const { pushProgramToDB, updateRules, pushSpecialisationToDB } = require('./updateDB');
const { replaceAll, storeErrorInFile } = require('./helperFunctions');

// Dynamic Queries
function convertRuleToQueryString(rule) {
    const isLike = rule["map"].operator_value === 'LIKE';
    const startsWith = rule["map"].operator_value === 'STARTSWITH';

    var queryString;
    switch (rule["map"].field) {
        case 'cs_tags':
            queryString = {
                "query_string": {
                    "fields": [
                        "unsw_psubject.csTags"
                    ],
                    "query": startsWith ? `${rule["map"].input_value}*` : (isLike ? `*${rule["map"].input_value}*` : rule["map"].input_value)
                }
            }
            break;
        case 'parent_academic_org':
            queryString = {
                "query_string": {
                    "fields": [
                        "unsw_psubject.parentAcademicOrg"
                    ],
                    "query": startsWith ? `${rule["map"].input_value}*` : (isLike ? `*${rule["map"].input_value}*` : rule["map"].input_value)
                }
            }
            break;
        case 'level':
            queryString = {
                "query_string": {
                    "fields": [
                        "unsw_psubject.levelNumber"
                    ],
                    "query": startsWith ? `${rule["map"].input_value}*` : (isLike ? `*${rule["map"].input_value}*` : rule["map"].input_value)
                }
            }
            break;
        case 'academic_org':
            queryString = {
                "query_string": {
                    "fields": [
                        "unsw_psubject.academicOrg"
                    ],
                    "query": startsWith ? `${rule["map"].input_value}*` : (isLike ? `*${rule["map"].input_value}*` : rule["map"].input_value)
                }
            }
            break;
        case 'code':
            queryString = {
                "query_string": {
                    "fields": [
                        "unsw_psubject.code"
                    ],
                    "query": startsWith ? `${rule["map"].input_value}*` : (isLike ? `*${rule["map"].input_value}*` : rule["map"].input_value)
                }
            }
            break;

        default:
            break;
    }

    return queryString;
}

function convertDynamicQueryToPostData(dynamicQuery, programInfo) {
    if (dynamicQuery.rule) {
        var equalsArray = [];
        var notEqualsArray = [];

        JSON.parse(dynamicQuery.rule).operator_group_members.map((queryParam) => {
            switch (queryParam["map"].operator_value) {
                case '=':
                case 'STARTSWITH':
                case 'LIKE':
                    const equalsQueryString = convertRuleToQueryString(queryParam);
                    if (equalsQueryString) {
                        equalsArray.push(equalsQueryString);
                    }
                    break;
                case '!=':
                    const notEqualsQueryString = convertRuleToQueryString(queryParam);
                    if (notEqualsQueryString) {
                        notEqualsArray.push(notEqualsQueryString);
                    }
                    break;

                default:
                    break;
            }
        });

        const postData = {
            "query": {
                "bool": {
                    "filter": [
                        {
                            "terms": {
                                "contenttype": [
                                    "unsw_psubject"
                                ]
                            }
                        },
                        {
                            "term": {
                                "live": true
                            }
                        }
                    ],
                    // ...equalsArray.length && { "must": equalsArray },
                    "must": equalsArray,
                    ...notEqualsArray.length && { "must_not": notEqualsArray }
                }
            },
            "sort": [
                {
                    "unsw_psubject.code_dotraw": "asc"
                }
            ],
            "from": 0,
            "size": 1000
        }

        return postData;
    }
    else if (dynamicQuery.dynamic_query) {
        const queries = dynamicQuery.dynamic_query.split('&');

        // Iterate over queries and convert
        var parsedQuery = [{
            "query_string": {
                "fields": [
                    "unsw_psubject.studyLevelValue"
                ],
                "query": programInfo.studyLevel
            }
        },
        {
            "query_string": {
                "fields": [
                    "unsw_psubject.implementationYear"
                ],
                "query": programInfo.year
            }
        }];
        queries.map((query) => {
            const splitQuery = query.split('=');
            switch (splitQuery[0]) {
                case 'faculty':
                    parsedQuery.push({
                        "query_string": {
                            "fields": [
                                splitQuery[1] === programInfo.faculty ? "unsw_psubject.parentAcademicOrg" : "unsw_psubject.academicOrg"
                            ],
                            "query": splitQuery[1]
                        }
                    });
                    break;

                case 'rx':
                    if (splitQuery[1].length < 10) {
                        parsedQuery.push({
                            "regexp": {
                                "unsw_psubject.code": splitQuery[1]
                            }
                        });
                    }
                    break;

                default:
                    break;
            }
        });

        const postData = {
            "query": {
                "bool": {
                    "filter": [
                        {
                            "terms": {
                                "contenttype": [
                                    "unsw_psubject"
                                ]
                            }
                        },
                        {
                            "term": {
                                "live": true
                            }
                        }
                    ],
                    "must": parsedQuery,
                }
            },
            "sort": [
                {
                    "unsw_psubject.code_dotraw": "asc"
                }
            ],
            "from": 0,
            "size": 1000
        }

        return postData;
    }
    else {
        return null;
    }
}

function getCoursesFromDynamicQuery(db, dynamicQuery, programInfo) {
    return new Promise(async (resolve, reject) => {
        try {
            const postData = convertDynamicQueryToPostData(dynamicQuery, programInfo);
            if (postData) {
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
                        'referer': 'https://www.handbook.unsw.edu.au/search?appliedFilters=eyJzZWFyY2giOnsiY3QiOiJzdWJqZWN0IiwiZXMiOnsicXVlcnkiOnsiYm9vbCI6eyJmaWx0ZXIiOlt7InRlcm1zIjp7ImNvbnRlbnR0eXBlIjpbInVuc3dfcHN1YmplY3QiXX19LHsidGVybSI6eyJsaXZlIjp0cnVlfX1dLCJtdXN0IjpbeyJxdWVyeV9zdHJpbmciOnsiZmllbGRzIjpbInVuc3dfcHN1YmplY3Quc3R1ZHlMZXZlbFZhbHVlIl0sInF1ZXJ5IjoidWdyZCJ9fSx7InF1ZXJ5X3N0cmluZyI6eyJmaWVsZHMiOlsidW5zd19wc3ViamVjdC5pbXBsZW1lbnRhdGlvblllYXIiXSwicXVlcnkiOiIyMDIxIn19LHsicmVnZXhwIjp7InVuc3dfcHN1YmplY3QuY29kZSI6Ii4uLi4xLi4uIn19XX19LCJzb3J0IjpbeyJ1bnN3X3BzdWJqZWN0LmNvZGVfZG90cmF3IjoiYXNjIn1dLCJmcm9tIjowLCJzaXplIjoxNX0sInByZWZpeCI6InVuc3dfcCJ9LCJkZXNjcmlwdGlvbiI6ImFueSBsZXZlbCAxIGNvdXJzZSIsInZlcnNpb24iOiIiLCJjb2RlIjoiVjFfMzUwMiIsInRpdGxlIjoiQ29tbWVyY2UiLCJydWxlSWQiOiJhYWMxZjU4NWRiNzU0MDUwMDM4Y2M0MDQ4YTk2MTljNSIsInNvdXJjZVVSTCI6Ii91bmRlcmdyYWR1YXRlL3Byb2dyYW1zLzIwMjAvMzUwMiIsInNvdXJjZVVSTFRleHRLZXkiOiJjc193aWxkY2FyZF9zb3VyY2VfYmFja19saW5rdGV4dCIsInNvdXJjZVR5cGUiOiJQcm9ncmFtIn0=',
                        'accept-language': 'en-US,en;q=0.9',
                    },
                    data: postData
                };

                axios(config)
                    .then(function (response) {
                        // Upload every course to a DB
                        // pushCoursesToDB(db, response.data.contentlets, programInfo.year);

                        // Return an array of JUST .code 
                        const courseCodes = response.data.contentlets.map((course) => { return { code: course.code, credit_points: course.credit_points || course.creditPoints || course.academic_item_credit_points } });
                        resolve(courseCodes);
                    })
                    .catch(function (error) {
                        console.log("AXIOS ERROR GETTING COURSES", error.response.status); // HERE
                        reject(error);
                    });
            }
            else {
                resolve();
            }
        } catch (ex) {
            console.log("EXCEPTION GETTING COURSES FROM DYNAMIC QUERY", ex);
            reject(ex);
        }
    });
}
// End Dynamic Queries

// To do: Change this to call the oldest server
// If request fails, try again with another server
var endpoints = [
    { name: "getcoursesfromrule", endpoint: "https://fu1xsxq2sc.execute-api.us-east-1.amazonaws.com", lastRun: "" },
    { name: "getcoursesfromrule2", endpoint: "https://ngy7jy6rb6.execute-api.us-east-1.amazonaws.com", lastRun: "" },
]

function getEndpoint() {
    // Find the endpoint that hasn't been used recently
    const endpointsSortedByUse = _.sortBy(endpoints, function(endpoint) {
        return '' || endpoint.lastRun
    });

    // Update the time it was used
    endpointsSortedByUse[0].lastRun = Date.now();

    return endpointsSortedByUse[0].endpoint;
}

function getCoursesFromRule(db, rule, programInfo) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log("Getting course from rule...");
            var config = {
                method: 'post',
                url: `${getEndpoint()}/getCourses`,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: { rule, programInfo }
            };

            axios(config)
                .then(function (response) {
                    resolve(response.data);
                })
                .catch(function (error) {
                    console.log("AXIOS ERROR GETTING COURSE FROM RULE", error);
                    reject(error);
                });

            console.log("Got course from rule");
        } catch (ex) {
            console.log("EXCEPTION GETTING COURSES FROM RULE", ex);
            reject(ex);
        }
    });
}

function getGeneralEducation(db, { faculty, year, studyLevel }) {
    return new Promise(async (resolve, reject) => {
        try {
            var data = {
                "query": {
                    "bool": {
                        "filter": [
                            {
                                "terms": {
                                    "contenttype": [
                                        "unsw_psubject"
                                    ]
                                }
                            },
                            {
                                "term": {
                                    "live": true
                                }
                            }
                        ],
                        "must": [
                            {
                                "query_string": {
                                    "fields": [
                                        "unsw_psubject.studyLevelValue"
                                    ],
                                    "query": studyLevel
                                }
                            },
                            {
                                "query_string": {
                                    "fields": [
                                        "unsw_psubject.implementationYear"
                                    ],
                                    "query": year
                                }
                            },
                            {
                                "query_string": {
                                    "fields": [
                                        "unsw_psubject.generalEducation"
                                    ],
                                    "query": "true"
                                }
                            }
                        ],
                        "must_not": [
                            {
                                "query_string": {
                                    "fields": [
                                        "unsw_psubject.parentAcademicOrg"
                                    ],
                                    "query": faculty
                                }
                            }
                        ]
                    }
                },
                "sort": [
                    {
                        "unsw_psubject.code_dotraw": "asc"
                    }
                ],
                "from": 0,
                "size": 1000
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
                    'referer': 'https://www.handbook.unsw.edu.au/search?appliedFilters=eyJzZWFyY2giOnsiY3QiOiJzdWJqZWN0IiwiZXMiOnsicXVlcnkiOnsiYm9vbCI6eyJmaWx0ZXIiOlt7InRlcm1zIjp7ImNvbnRlbnR0eXBlIjpbInVuc3dfcHN1YmplY3QiXX19LHsidGVybSI6eyJsaXZlIjp0cnVlfX1dLCJtdXN0IjpbeyJxdWVyeV9zdHJpbmciOnsiZmllbGRzIjpbInVuc3dfcHN1YmplY3Quc3R1ZHlMZXZlbFZhbHVlIl0sInF1ZXJ5IjoidWdyZCJ9fSx7InF1ZXJ5X3N0cmluZyI6eyJmaWVsZHMiOlsidW5zd19wc3ViamVjdC5pbXBsZW1lbnRhdGlvblllYXIiXSwicXVlcnkiOiIyMDIxIn19LHsicXVlcnlfc3RyaW5nIjp7ImZpZWxkcyI6WyJ1bnN3X3BzdWJqZWN0LmNzVGFncyJdLCJxdWVyeSI6Iio5NmQ5YmFlNGRiMmQ0ODEwZmM5MzY0ZTcwNTk2MTkzYSoifX1dLCJtdXN0X25vdCI6W3sicXVlcnlfc3RyaW5nIjp7ImZpZWxkcyI6WyJ1bnN3X3BzdWJqZWN0LnBhcmVudEFjYWRlbWljT3JnIl0sInF1ZXJ5IjoiNWEzYTFkNGY0ZjRkOTc0MDRhYTZlYjRmMDMxMGM3N2EifX1dfX0sInNvcnQiOlt7InVuc3dfcHN1YmplY3QuY29kZV9kb3RyYXciOiJhc2MifV0sImZyb20iOjAsInNpemUiOjE1fSwicHJlZml4IjoidW5zd19wIn0sImRlc2NyaXB0aW9uIjoiYW55IEdlbmVyYWwgRWR1Y2F0aW9uIGNvdXJzZSIsInZlcnNpb24iOiIiLCJjb2RlIjoiVjFfMzUwMiIsInRpdGxlIjoiQ29tbWVyY2UiLCJydWxlSWQiOiI1NmMxZjU4NWRiNzU0MDUwMDM4Y2M0MDQ4YTk2MTlhZiIsInNvdXJjZVVSTCI6Ii91bmRlcmdyYWR1YXRlL3Byb2dyYW1zLzIwMjAvMzUwMiIsInNvdXJjZVVSTFRleHRLZXkiOiJjc193aWxkY2FyZF9zb3VyY2VfYmFja19saW5rdGV4dCIsInNvdXJjZVR5cGUiOiJQcm9ncmFtIn0=',
                    'accept-language': 'en-US,en;q=0.9',
                },
                data: data
            };

            const response = await axios(config); // HERE

            // Upload every course to a DB
            // pushCoursesToDB(db, response.data.contentlets, year);

            // Return an array of JUST .code 
            const courseCodes = response.data.contentlets.map((course) => { return { code: course.code, credit_points: course.credit_points || course.creditPoints || course.academic_item_credit_points } });
            resolve(courseCodes);
        } catch (ex) {
            console.log("EXCEPTION GETTING GENERAL EDUCATION", ex);
            reject(ex);
        }
    });
}

function parseCurriculumStructure(db, rules, programInfo, specialisation) {
    return new Promise(async (resolve, reject) => {
        try {
            var rulesToPush = {
                Core_Course: [],
                Prescribed_Elective: [],
                Information_Rule: [],
                Maturity_Rule: [],
                Limit_Rule: [],
                Free_Elective: [],
                minor: [],
                major: [],
                honours: [],
                specialisation: [],
                One_of_the_following: [],
                General_Education: []
            }

            const promises = rules.map((rule) => {
                return new Promise(async (resolve, reject) => {
                    try {
                        // Handle Core Courses and Prescribed Electives
                        if (['Core Course', 'Prescribed Elective', 'One of the following'].includes(rule.vertical_grouping.label)) {
                            const courses = await getCoursesFromRule(db, rule, programInfo);
                            rulesToPush[replaceAll(rule.vertical_grouping.label, ' ', '_')].push(courses);

                            resolve(courses);
                        }
                        // Get Majors/Minors
                        else if (['DS', 'Undergraduate Major', 'Undergraduate Minor', 'Any Specialisation'].includes(rule.vertical_grouping.label)) {
                            // const getData = async () => {
                            //     return Promise.all(rule.relationship.map(specialisation => getSpecAsync(db, {
                            //         specialisation_code: specialisation.academic_item_code,
                            //         specialisation_description: specialisation.description,
                            //         specialisation_type: specialisation.academic_item_type.value,
                            //         implementation_year: specialisation.implementation_year
                            //     }, programInfo)));
                            // }

                            rule.relationship.map((specialisation) => {
                                rulesToPush[specialisation.academic_item_type.value].push(specialisation.academic_item_code);
                            });

                            resolve();

                            // getData().then(data => {
                            //     resolve(data); // Do I have to wait for this?
                            // });
                        }
                        // General Education
                        else if (rule.vertical_grouping.label === 'General Education') {
                            const generalEducation = await getGeneralEducation(db, programInfo);
                            const returnObject = {
                                credit_points: rule.credit_points,
                                courses: generalEducation,
                                description: rule.description
                            }

                            rulesToPush[replaceAll(rule.vertical_grouping.label, ' ', '_')].push(returnObject);

                            // await updateItemWithCourses(db, programInfo, specialisation, returnObject, rule.vertical_grouping.label);
                            resolve(returnObject);
                        }
                        // Limit Rule and Free Elective
                        else if (['Limit Rule', 'Free Elective'].includes(rule.vertical_grouping.label)) {
                            const courses = await getCoursesFromRule(db, rule, programInfo);
                            rulesToPush[rule.vertical_grouping.label.replace(' ', '_')].push(courses);

                            resolve(courses);
                        }
                        else if (['Maturity Rule', 'Information Rule', 'SR'].includes(rule.vertical_grouping.label)) {
                            const newRule = {
                                description: rule.description,
                                url: rule.dynamic_relationship.length ? rule.dynamic_relationship[0].encodedURL : null
                            }

                            const ruleName = rule.vertical_grouping.label === 'Maturity Rule' ? 'Maturity_Rule' : 'Information_Rule';
                            rulesToPush[ruleName].push(newRule);

                            resolve();
                        }
                        else {
                            if (!rule.container || !rule.container.length) {
                                console.log(`Unknown rule: ${rule.vertical_grouping.label}...`);
                                const specName = specialisation ? `_${specialisation.specialisation_code}.json` : '.json';
                                await storeErrorInFile(`${programInfo.programCode}_${programInfo.year}${specName}`, JSON.stringify(rule));
                            }

                            resolve(null);
                        }

                        if (rule.container && rule.container.length) {
                            await parseCurriculumStructure(db, rule.container, programInfo, specialisation);
                        }
                    } catch (ex) {
                        console.log("EXCEPTION PARSING RULES IN PROMISES", ex);
                        reject(ex);
                    }
                });
            });

            const parsedRules = await Promise.all(promises);
            updateRules(db, programInfo, specialisation, rulesToPush);

            resolve(parsedRules);
        } catch (exception) {
            console.log("EXCEPTION PARSING CURRICULUM STRUCTURE", exception);
            reject(exception);
        }
    });
}

const getSpecAsync = async (db, specialisation, programInfo) => {
    return getSpecialisation(db, specialisation, programInfo);
}

async function getSpecialisation(db, specialisation, programInfo) {
    return new Promise(async (resolve, reject) => {
        try {
            // New request here:
            var data = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "query_string": {
                                    "query": `unsw_paos.code: ${specialisation.specialisation_code}`
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
                                                "query": "undergraduate"
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
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.111 Safari/537.36',
                    'content-type': 'application/json;charset=UTF-8',
                    'origin': 'https://www.handbook.unsw.edu.au',
                    'sec-fetch-site': 'same-origin',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-dest': 'empty',
                    'referer': 'https://www.handbook.unsw.edu.au/undergraduate/specialisations/2021/ACCTA1',
                    'accept-language': 'en-US,en;q=0.9',
                },
                data: data
            };

            const response = await axios(config); // HERE
            if (response.status === 403) {
                // IP got blocked, need to try again
                console.log("BLOCKED IP");
            }

            // Specialisation doesn't exist in this year
            if (response.data.contentlets.length === 0) {
                resolve(null);
            }
            else {
                let programPromises = response.data.contentlets.map((currentYear) => {
                    return new Promise(async (resolve, reject) => {
                        try {
                            const year = JSON.parse(currentYear.CurriculumStructure).implementation_year;
                            const specialisationToPush = {
                                specialisation_code: specialisation.specialisation_code,
                                specialisation_type: specialisation.specialisation_type,
                                implementation_year: String(year)
                            }

                            // Update DB with specialisation (TODO: Don't make this await)
                            await pushSpecialisationToDB(db, specialisationToPush);
                            await parseCurriculumStructure(db, JSON.parse(currentYear.CurriculumStructure).container, programInfo, specialisationToPush);

                            resolve();
                        } catch (ex) {
                            console.log(`EXCEPTION PARSING SPECIALISATION STRUCTURE ${specialisation.specialisation_code}, ${JSON.parse(currentYear.CurriculumStructure).implementation_year}`, ex);
                            reject(ex);
                        }
                    });
                });

                await Promise.all(programPromises);

                resolve();
            }

        } catch (exception) {
            console.log(`EXCEPTION GETTING SPECIALISATION FOR ${specialisation.specialisation_code} IN ${specialisation.implementation_year}`, exception);
            reject(exception);
        }
    });
}

module.exports = {
    parseProgram: function (db, programInfo, curriculumStructure) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`Parsing ${programInfo.title}, ${programInfo.year}...`);
                pushProgramToDB(programInfo, db);

                await parseCurriculumStructure(db, curriculumStructure.container, programInfo);

                console.log(`Parsed ${programInfo.title}, ${programInfo.year}...`);
                resolve();
            } catch (ex) {
                console.log("EXCEPTION PARSING PROGRAM", ex);
                reject(ex);
            }
        });
    }, 
    parseSpecialisation: function (db, specialisation, programInfo) {
        return new Promise(async (resolve, reject) => {
            try {
                await getSpecialisation(db, specialisation, programInfo);
                resolve();
            } catch (exception) {
                console.log(`EXCEPTION GETTING SPECIALISATION FOR ${specialisation.specialisation_code} IN ${specialisation.implementation_year}`, exception);
                reject(exception);
            }
        });
    }
}