/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as dotenv from "dotenv";
import {
    LambdaClient,
    ListFunctionsCommand,
    ListVersionsByFunctionCommand,
    DeleteFunctionCommand
} from "@aws-sdk/client-lambda";
import {Logger} from "../common/Logger";
import {delay} from '@esutils/delay';
import {Database} from "../common/Database";

dotenv.config();

class Cleaner {
    private logger = Logger.getLogger();
    private db = Database.getDb();
    private regexPattern = process.env.LAMBDA_REGEX_PATTERN || "";
    private config = {
        region: process.env.AWS_REGION || "",
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
        }
    };
    private versionsKeep = 5;

    async run(): Promise<void> {
        this.logger.info('Begin script');

        let lstFunctions: any = [];
        let next: boolean = true;
        const client = new LambdaClient(this.config);

        try {
            lstFunctions = await this.db.getData("/lstFunctions");
        } catch (err) {
        }

        if (lstFunctions.length > 0) {
            this.logger.info('Working with lstFunctions from local db');
        }

        if (lstFunctions.length == 0) {
            let paramsListFunctions: any = {
                MaxItems: 50
            };

            this.logger.info('Fetch lambda list');
            while (next) {
                next = false;
                let command = new ListFunctionsCommand(paramsListFunctions);
                let response = await client.send(command);

                if (response.Functions && response.Functions.length > 0) {
                    response.Functions.map(x => {
                        lstFunctions.push({
                            name: x.FunctionName,
                            arn: x.FunctionArn
                        })
                    });

                    if (response.NextMarker) {
                        next = true;
                        paramsListFunctions = {
                            Marker: response.NextMarker,
                            MaxItems: 50
                        };
                    }
                }
            }

            this.logger.info('Filter lambdas by regex');
            lstFunctions = lstFunctions.filter(x => {
                const regex = new RegExp(this.regexPattern);
                return regex.test(x.name);
            });

            this.logger.info('Save lstFunctions on local db');
            await this.db.push("/lstFunctions", lstFunctions);
        }

        this.logger.info('Fetch lambdas versions');
        let lambdasWithVersions: any = [];

        try {
            lambdasWithVersions = await this.db.getData("/lambdasWithVersions");
        } catch (err) {
        }

        await Promise.all(lstFunctions.map(async (x) => {
            next = true;
            let versions: any = [];

            let params: any = {
                FunctionName: x.name,
                MaxItems: 50
            };

            if (lambdasWithVersions.indexOf(x.name) === -1) {
                while (next) {
                    next = false;

                    try {
                        this.logger.info(`Fetch versions of ${x.name}`);
                        let command = new ListVersionsByFunctionCommand(params);
                        let response = await client.send(command);

                        await this.db.push("/lambdasWithVersions", [x.name], false);

                        if (response.Versions && response.Versions.length > 0) {
                            response.Versions.map(x => {
                                if (x.Version && x.Version !== '$LATEST') {
                                    versions.push(parseInt(x.Version));
                                }
                            });

                            if (response.NextMarker) {
                                next = true;
                                params = {
                                    FunctionName: x.name,
                                    Marker: response.NextMarker,
                                    MaxItems: 50
                                };
                            }
                        }
                    } catch (err) {
                        this.logger.error({data: x.name, err});
                    }
                }

                x['versions'] = versions;
            }
        }));

        this.logger.info('Save lstFunctions with versions on local db');
        await this.db.push("/lstFunctions", lstFunctions);

        this.logger.info('Filter lambdas versions');
        lstFunctions.map((x) => {
            x['versionsDelete'] = [];

            if (x.versions.length >= this.versionsKeep) {
                x['versionsDelete'] = x.versions
                    .sort((a, b) => a - b)
                    .splice(0, x.versions.length - 2);
            }
        });

        this.logger.info('Delete lambdas old versions');
        let deleteErrors = 0;

        for (let x of lstFunctions) {
            for (let v of x.versionsDelete) {
                try {
                    let params: any = {
                        FunctionName: x.name,
                        Qualifier: '' + v
                    };

                    let command = new DeleteFunctionCommand(params);
                    await client.send(command);
                    this.logger.info(`Deleted: ${x.name} | ${v}`);
                    await delay(100);
                } catch (err) {
                    this.logger.error({data: `${x.name} | ${v}`, err});
                    deleteErrors++;
                }
            }
        }

        // await Promise.all(lstFunctions.map(async (x) => {
        //     await Promise.all(x.versionsDelete.map(async (v) => {
        //         try {
        //             let params: any = {
        //                 FunctionName: x.name,
        //                 Qualifier: '' + v
        //             };
        //
        //             let command = new DeleteFunctionCommand(params);
        //             await client.send(command);
        //             this.logger.info(`Deleted: ${x.name} | ${v}`);
        //             await delay(1000);
        //         } catch (err) {
        //             this.logger.error({data: `${x.name} | ${v}`, err});
        //             deleteErrors++;
        //         }
        //     }));
        // }));

        await this.db.push("/deleteErrors", deleteErrors);

        this.logger.info(`Delete Errors: ${deleteErrors}`);
        this.logger.info('End script');

        if (deleteErrors > 0) {
            await this.db.delete("/");
        }
    }
}


void async function () {
    const script = new Cleaner();
    await script.run();
}();
