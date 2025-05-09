/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as dotenv from "dotenv";
import {JsonDB, Config} from 'node-json-db';
import {Logger} from "./Logger";

dotenv.config();

class Database {
    private logger = Logger.getLogger();
    private static db: JsonDB;

    public static getDb(): JsonDB {
        Database.db = new JsonDB(new Config(__dirname + '/../../storage/database', true, true, '/'));

        return Database.db;
    }
}

export {Database}
