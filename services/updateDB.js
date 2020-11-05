// Libraries

// Helper functions
const { update } = require('./database');
const { getSpecialisation } = require('./handbook');

var localStorage = {};

module.exports = {
    pushProgramToDB: function (programInfo, db) {
        return new Promise(async (resolve, reject) => {
            try {
                var params = {
                    TableName: 'programs',
                    Key: {
                        code: String(programInfo.programCode),
                        implementation_year: programInfo.year
                    }
                };

                db.get(params, async function (err, data) {
                    if (err) {
                        console.log("AWS ERROR GETTING PROGRAM", err);
                        console.log("Errored program", programInfo);
                        reject(err);
                    }
                    else {
                        const existingProgram = data.Item;
                        if (!existingProgram) {
                            await update(db, 'programs', {
                                "code": String(programInfo.programCode),
                                "implementation_year": programInfo.year,
                                "faculty": programInfo.faculty,
                                "title": programInfo.title,
                                "studyLevel": programInfo.studyLevel,
                                "minimumUOC": programInfo.minimumUOC,
                                "Information_Rule": [],
                                "Maturity_Rule": [],
                                "minor": [],
                                'major': []
                            });
                        }
                        resolve();
                    }
                });
            } catch (ex) {
                console.log("EXCEPTION PUSHING PROGRAM TO DB", ex);
                reject(ex);
            }
        });
    }, 
    updateRules: function (db, programInfo, specialisation, rulesToPush) {
        return new Promise(async (resolve, reject) => {
            try {
                // Get the program or specialisation
                const existingDocument = specialisation ? localStorage[`${specialisation.specialisation_code}_${specialisation.implementation_year}`] : localStorage[`${String(programInfo.programCode)}_${programInfo.year}`];

                var coreCourses;
                if (existingDocument && rulesToPush.Core_Course.length && existingDocument['coreCourses'] && existingDocument['coreCourses'].length) {
                    coreCourses = rulesToPush.Core_Course.concat(existingDocument['coreCourses']);
                }

                var prescribedElectives;
                if (existingDocument && rulesToPush.Prescribed_Elective.length && existingDocument['prescribedElectives'] && existingDocument['prescribedElectives'].length) {
                    prescribedElectives = rulesToPush.Prescribed_Elective.concat(existingDocument['prescribedElectives']);
                }

                var majors;
                if (existingDocument && rulesToPush.major.length && existingDocument['majors'] && existingDocument['majors'].length) {
                    majors = rulesToPush.major.concat(existingDocument['majors']);
                }

                var minors;
                if (existingDocument && rulesToPush.minor.length && existingDocument['minors'] && existingDocument['minors'].length) {
                    minors = rulesToPush.minor.concat(existingDocument['minors']);
                }

                var oneOfTheFollowings;
                if (existingDocument && rulesToPush.One_of_the_following.length && existingDocument['oneOfTheFollowings'] && existingDocument['oneOfTheFollowings'].length) {
                    oneOfTheFollowings = rulesToPush.One_of_the_following.concat(existingDocument['oneOfTheFollowings']);
                }

                // Update the program
                var updateParams = {
                    ...specialisation ? { specialisation_code: specialisation.specialisation_code } : { code: String(programInfo.programCode) },
                    implementation_year: specialisation ? specialisation.implementation_year : programInfo.year,
                    ...rulesToPush.Information_Rule.length && { 'informationRules': rulesToPush.Information_Rule },
                    ...rulesToPush.Maturity_Rule.length && { 'maturityRules': rulesToPush.Maturity_Rule },
                    ...rulesToPush.Limit_Rule.length && { 'limitRules': rulesToPush.Limit_Rule },
                    ...rulesToPush.Free_Elective.length && { 'freeElectives': rulesToPush.Free_Elective },
                    ...rulesToPush.minor.length && { 'minors': minors ? minors : rulesToPush.minor },
                    ...rulesToPush.major.length && { 'majors': majors ? majors : rulesToPush.major },
                    ...rulesToPush.honours.length && { 'honours': rulesToPush.honours },
                    ...rulesToPush.Core_Course.length && { 'coreCourses': coreCourses ? coreCourses : rulesToPush.Core_Course },
                    ...rulesToPush.Prescribed_Elective.length && { 'prescribedElectives': prescribedElectives ? prescribedElectives : rulesToPush.Prescribed_Elective },
                    ...rulesToPush.One_of_the_following.length && { 'oneOfTheFollowings': oneOfTheFollowings ? oneOfTheFollowings : rulesToPush.One_of_the_following },
                    ...rulesToPush.specialisation.length && { 'specialisations': rulesToPush.specialisation },
                    ...rulesToPush.General_Education && { 'generalEducation': rulesToPush.General_Education }
                }

                if (specialisation) {
                    localStorage[`${specialisation.specialisation_code}_${specialisation.implementation_year}`] = existingDocument ? Object.assign(existingDocument, updateParams) : updateParams;
                    await update(db, 'specialisations', localStorage[`${specialisation.specialisation_code}_${specialisation.implementation_year}`]);
                }
                else {
                    localStorage[`${String(programInfo.programCode)}_${programInfo.year}`] = existingDocument ? Object.assign(existingDocument, updateParams) : updateParams;
                    await update(db, 'programs', localStorage[`${String(programInfo.programCode)}_${programInfo.year}`]);
                }

                resolve();

            } catch (ex) {
                console.log("EXCEPTION UPDATING RULES", ex);
                reject(ex);
            }
        });
    }, 
    getSpecAsync: async (db, specialisation, programInfo) => {
        return getSpecialisation(db, specialisation, programInfo);
    }, 
    pushSpecialisationToDB: function (db, specialisation) {
        return new Promise(async (resolve, reject) => {
            try {
                var params = {
                    TableName: 'specialisations',
                    Key: {
                        specialisation_code: specialisation.specialisation_code,
                        implementation_year: specialisation.implementation_year
                    }
                };

                db.get(params, async function (err, data) {
                    if (err) {
                        console.log("AWS ERROR GETTING SPECIALISATION", err);
                        console.log("Errored Spec", specialisation);
                        reject(err);
                    }
                    else {
                        const existingSpecialisation = data.Item;
                        if (!existingSpecialisation) {
                            await update(db, 'specialisations', specialisation);
                        }
                        resolve();
                    }
                });
            } catch (ex) {
                console.log("EXCEPTION CREATING SPECIALISATION", ex);
                reject(ex);
            }
        });
    }
}