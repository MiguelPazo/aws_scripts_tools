/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as dotenv from "dotenv";
import {Logger} from "../common/Logger";
import {Database} from "../common/Database";
import {delay} from '@esutils/delay';
import * as fs from "fs";
import * as byline from "byline";
import * as https from 'https';
import * as crypto from 'crypto';

dotenv.config();

const logger = Logger.getLogger();
const appEnv = process.env.APP_ENV || "";
const openSearchEndpoint = process.env.OPENSEARCH_ENDPOINT || "";

function transform(line: any) {
    const separator = '{""domain""';
    let logEvent = line.substring(line.indexOf(separator), line.length - 1).replace(/""/g, '"');
    logEvent = JSON.parse(logEvent);

    let logGroupAtr = line.substring(0, line.indexOf(separator)).split(',');

    let bulkRequestBody = '';
    const logDate = new Date(logEvent.logDate);

    const indexPrefix = [
        `cwl-${appEnv}-${logEvent.domain}`,
        logGroupAtr[2]
    ].join('-');

    const indexDate = [
        logDate.getUTCFullYear(),
        ('0' + (logDate.getUTCMonth() + 1)).slice(-2),
        ('0' + logDate.getUTCDate()).slice(-2)
    ].join('.')

    const indexName = `${indexPrefix}-${indexDate}`

    logEvent['@timestamp'] = logDate.toISOString();
    logEvent['@message'] = JSON.stringify(logEvent);
    logEvent['@owner'] = logGroupAtr[1].split(':')[0];
    logEvent['@log_group'] = logGroupAtr[1].split(':')[1];
    logEvent['@log_stream'] = logGroupAtr[2];

    let action: any = {"index": {}};
    action.index._index = indexName;

    bulkRequestBody += [
        JSON.stringify(action),
        JSON.stringify(logEvent),
    ].join('\n') + '\n';

    return bulkRequestBody;
}

function post(body): Promise<any> {
    const requestParams = buildRequest(openSearchEndpoint, body);

    return new Promise<any>(async (resolve, reject) => {
        const request = https.request(requestParams, function (response: any) {
            let responseBody = '';

            response.on('data', function (chunk) {
                responseBody += chunk;
            });

            response.on('end', function () {
                let info: any = JSON.parse(responseBody);
                let failedItems;
                let success;
                let error;

                if (response.statusCode >= 200 && response.statusCode < 299) {
                    failedItems = info.items.filter(function (x) {
                        return x.index.status >= 300;
                    });

                    success = {
                        "attemptedItems": info.items.length,
                        "successfulItems": info.items.length - failedItems.length,
                        "failedItems": failedItems.length
                    };
                }

                if (response.statusCode !== 200 || info.errors === true) {
                    delete info['items'];

                    error = {
                        statusCode: response.statusCode,
                        responseBody: info
                    };
                }

                resolve({error, success, statusCode: response.statusCode, failedItems});
            });
        }).on('error', function (e) {
            reject(e);
        });

        request.end(requestParams.body);
    });
}

function buildRequest(openSearchEndpoint, body) {
    let endpointParts = openSearchEndpoint.match(/^([^\.]+)\.?([^\.]*)\.?([^\.]*)\.amazonaws\.com$/);
    let region = endpointParts[2];
    let service = endpointParts[3];
    let datetime = (new Date()).toISOString().replace(/[:\-]|\.\d{3}/g, '');
    let date = datetime.substr(0, 8);
    let kDate = hmac('AWS4' + process.env.AWS_SECRET_ACCESS_KEY, date);
    let kRegion = hmac(kDate, region);
    let kService = hmac(kRegion, service);
    let kSigning = hmac(kService, 'aws4_request');
    let request: any = {
        host: openSearchEndpoint,
        method: 'POST',
        path: '/_bulk',
        body: body,
        headers: {
            'Content-Type': 'application/json',
            'Host': openSearchEndpoint,
            'Content-Length': Buffer.byteLength(body),
            'X-Amz-Security-Token': process.env.AWS_SESSION_TOKEN,
            'X-Amz-Date': datetime
        }
    };

    let canonicalHeaders = Object.keys(request.headers)
        .sort(function (a, b) {
            return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
        })
        .map(function (k) {
            return k.toLowerCase() + ':' + request.headers[k];
        })
        .join('\n');

    let signedHeaders = Object.keys(request.headers)
        .map(function (k) {
            return k.toLowerCase();
        })
        .sort()
        .join(';');

    let canonicalString = [
        request.method,
        request.path, '',
        canonicalHeaders, '',
        signedHeaders,
        hash(request.body, 'hex'),
    ].join('\n');

    let credentialString = [date, region, service, 'aws4_request'].join('/');

    let stringToSign = [
        'AWS4-HMAC-SHA256',
        datetime,
        credentialString,
        hash(canonicalString, 'hex')
    ].join('\n');

    request.headers.Authorization = [
        'AWS4-HMAC-SHA256 Credential=' + process.env.AWS_ACCESS_KEY_ID + '/' + credentialString,
        'SignedHeaders=' + signedHeaders,
        'Signature=' + hmac(kSigning, stringToSign, 'hex')
    ].join(', ');

    return request;
}

function hmac(key, str, encoding?) {
    return crypto.createHmac('sha256', key).update(str, 'utf8').digest(encoding);
}

function hash(str, encoding?) {
    return crypto.createHash('sha256').update(str, 'utf8').digest(encoding);
}

class LoadLogs {
    private db = Database.getDb();

    async run(): Promise<void> {
        logger.info('Begin script');

        const file = __dirname + '/../../storage/logs.csv'
        let stream: any = fs.createReadStream(file, {encoding: 'utf8'});
        stream = byline.createStream(stream);
        let lineNumber = 0;

        stream.on('data', async function (line) {
            lineNumber++;

            if (line.indexOf('domain"') === -1) {
                return;
            }

            logger.info(`Line ${lineNumber} - begin process`);

            const elasticsearchBulkData = transform(line);

            if (!elasticsearchBulkData) {
                logger.info(`Line ${lineNumber} - error generating elasticsearchBulkData`);
                return;
            }

            try {
                stream.pause();

                logger.info(`Line ${lineNumber} - sending POST`);
                const result = await post(elasticsearchBulkData);
                logger.info(`Line ${lineNumber} - result: ${result.statusCode}`);

                if (result.statusCode !== 200) {
                    logger.info(result);
                }
            } catch (err: any) {
                logger.error(`Line ${lineNumber} - error on POST: ${err} \n${err.stack}`);
            }

            stream.resume();
        });

        stream.on('end', function () {
            logger.info('End script');
        });
    }
}


void async function () {
    const script = new LoadLogs();
    await script.run();
}();
