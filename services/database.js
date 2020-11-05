

module.exports = {
    update: function (db, table, dataToUpdate) {
        return new Promise((resolve, reject) => {
            try {
                var params = {
                    TableName: table,
                    Item: dataToUpdate
                };

                db.put(params, function (err, data) {
                    if (err) {
                        console.error("AWS EXCEPTION UPDATING DB", JSON.stringify(err, null, 2));
                        reject(err);
                    } else {
                        // console.log("Added item:", JSON.stringify(data, null, 2));
                        resolve(data);
                    }
                });

            } catch (ex) {
                console.log("EXCEPTION UPDATING DB", ex);
                reject(ex);
            }
        });
    }
}