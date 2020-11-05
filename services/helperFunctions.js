const fs = require('file-system');

module.exports = {
    replaceAll: function (str, find, replace) {
        return str.replace(new RegExp(find, 'g'), replace);
    }, 
    storeErrorInFile: function (filename, error) {
        return new Promise(async (resolve, reject) => {
            try {
                fs.appendFile(`../warnings/${filename}`, error, function (err) {
                    if (err) {
                        console.log("FS ERROR STORING ERROR IN FILE", err);
                        reject(err);
                    }
                    else {
                        resolve();
                    }
                });
            } catch (ex) {
                console.log("EXCEPTION STORING ERROR IN FILE", ex);
                reject(ex);
            }
        });
    }, 
    getProgramInfo: function (currentYearData) {
        const year = currentYearData.implementation_year;
        const faculty = currentYearData.parent_academic_org.cl_id || currentYearData.owning_org.cl_id;
        const title = currentYearData.title;
        const studyLevel = currentYearData.study_level_single.value;
        const minimumUOC = currentYearData.credit_points;
        const programCode = currentYearData.course_code || currentYearData.code;

        const programInfo = { 
            year, 
            faculty, 
            title, 
            studyLevel, 
            minimumUOC, 
            programCode, 
            ...currentYearData.subclass.value && { specialisation_type: currentYearData.subclass.value }
        };
        return programInfo;
    }
}