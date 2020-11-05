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
    }
}