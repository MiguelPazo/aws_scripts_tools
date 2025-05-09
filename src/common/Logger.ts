/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as dotenv from "dotenv";
import {Logger as libLog} from "tslog";

dotenv.config();

class Logger {
    private static logger: libLog;

    public static getLogger(): libLog {
        if (process.env.NODE_ENV === 'production') {
            Logger.logger = new libLog({name: "server", type: "json"});
        } else {
            Logger.logger = new libLog({name: "server"});
        }

        return this.logger;
    }
}

export {Logger}
