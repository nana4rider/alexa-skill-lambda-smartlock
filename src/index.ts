import axios from 'axios';
import { DateTime } from 'luxon';
import { v4 as uuid } from 'uuid';
import { getDynamoDB } from './function';

const db = getDynamoDB();

require('./config');

exports.handler = async (request: any) => {
  const directiveNamespace = request.directive.header.namespace;
  const directiveName = request.directive.header.name;

  let response: any;
  console.log('[request]', directiveNamespace, directiveName);

  try {
    if (directiveNamespace === 'Alexa.Discovery' && directiveName === 'Discover') {
      // 機器登録
      response = await handleDiscover(request);
    } else if (directiveNamespace === 'Alexa.Authorization' && directiveName === 'AcceptGrant') {
      // 認証
      response = await handleAcceptGrant(request);
    } else if (directiveNamespace == 'Alexa' && directiveName == 'ReportState') {
      // 状態レポート
      response = await handleReportState(request);
    } else if (directiveNamespace === 'Alexa.LockController' && directiveName === 'Lock') {
      // 施錠
      response = await handleChangeLock(request, true);
    } else if (directiveNamespace === 'Alexa.LockController' && directiveName === 'Unlock') {
      // 解錠
      response = await handleChangeLock(request, false);
    } else {
      throw new Error(`namespace: ${directiveNamespace}, name: ${directiveName}`);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    response = handleError(request, error);
  }

  console.log('[response]', response.event.header.namespace, response.event.header.name);
  return response;
};

/**
 * エラー処理
 *
 * @param request
 * @param error
 * @returns
 */
function handleError(request: any, error: Error) {
  const endpointId = request.directive.endpoint.endpointId as string;

  const payload = { type: 'INTERNAL_ERROR', message: error.message };

  console.log('[error]', error.message);

  return {
    'event': {
      'header': {
        'namespace': 'Alexa',
        'name': 'ErrorResponse',
        'messageId': uuid(),
        'payloadVersion': '3'
      },
      'endpoint': {
        'endpointId': endpointId
      },
      'payload': payload
    }
  };
}

/**
 * 機器登録
 *
 * @param request
 * @returns
 */
async function handleDiscover(request: any): Promise<object> {
  const endpoints = [];

  const scanResult = await db.scan({
    TableName: 'alexa_home_lock_devices'
  }).promise();

  if (!scanResult.Items) {
    throw new Error('機器が1台も登録されていません');
  }

  for (const device of scanResult.Items) {
    endpoints.push({
      'endpointId': device.id,
      'manufacturerName': 'Smart Lock',
      'friendlyName': device.name,
      'description': device.name,
      'displayCategories': ['SMARTLOCK'],
      'capabilities': [
        {
          'type': 'AlexaInterface',
          'interface': 'Alexa',
          'version': '3'
        },
        {
          'type': 'AlexaInterface',
          'interface': 'Alexa.LockController',
          'version': '3',
          'properties': {
            'supported': [
              {
                'name': 'lockState'
              }
            ],
            'proactivelyReported': false,
            'retrievable': true
          }
        }
      ]
    });
  }

  return {
    'event': {
      'header': {
        'namespace': 'Alexa.Discovery',
        'name': 'Discover.Response',
        'payloadVersion': '3',
        'messageId': uuid()
      },
      'payload': { 'endpoints': endpoints }
    }
  };
}

/**
 * 認証
 *
 * @param request
 * @returns
 */
async function handleAcceptGrant(request: any) {
  return {
    'event': {
      'header': {
        'namespace': 'Alexa.Authorization',
        'name': 'AcceptGrant.Response',
        'payloadVersion': '3',
        'messageId': uuid()
      },
      'payload': {}
    }
  };
}

/**
 * 状態レポート
 * https://developer.amazon.com/ja-JP/docs/alexa/device-apis/alexa-thermostatcontroller.html#state-report
 *
 * @param request
 * @returns
 */
async function handleReportState(request: any) {
  const endpointId = request.directive.endpoint.endpointId as string;

  const scanResult = await db.get({
    TableName: 'alexa_home_lock_devices',
    Key: { id: endpointId }
  }).promise();

  if (!scanResult.Item) {
    throw new Error(`指定された機器が見つかりません: ${endpointId}`);
  }

  const apiUrl = scanResult.Item.apiUrl as string;
  const apiKey = scanResult.Item.apiKey as string;

  const reponse = await axios.get(apiUrl, {
    headers: { 'Authorization': `Api-Key ${apiKey}` },
  });

  const lock = reponse.data.state === 'LOCK';
  const now = DateTime.local().toISO();

  return {
    'event': {
      'header': {
        'namespace': 'Alexa',
        'name': 'StateReport',
        'messageId': uuid(),
        'correlationToken': request.directive.header.correlationToken,
        'payloadVersion': '3'
      },
      'endpoint': {
        'endpointId': endpointId
      }
    },
    'context': {
      'properties': [
        {
          'namespace': 'Alexa.LockController',
          'name': 'lockState',
          'value': lock ? 'LOCKED' : 'UNLOCKED',
          'timeOfSample': now,
          'uncertaintyInMilliseconds': 0
        }
      ]
    }
  };
}

/**
 * ロック状態変更
 * https://developer.amazon.com/ja-JP/docs/alexa/device-apis/alexa-lockcontroller.html#unlock-directive
 *
 * @param event
 * @param lock
 * @returns
 */
async function handleChangeLock(request: any, lock: boolean) {
  const endpointId = request.directive.endpoint.endpointId as string;

  const scanResult = await db.get({
    TableName: 'alexa_home_lock_devices',
    Key: { id: endpointId }
  }).promise();

  if (!scanResult.Item) {
    throw new Error(`指定された機器が見つかりません: ${endpointId}`);
  }

  const apiUrl = scanResult.Item.apiUrl as string;
  const apiKey = scanResult.Item.apiKey as string;

  await axios.put(apiUrl,
    { 'state': lock ? 'LOCK' : 'UNLOCK' },
    { headers: { 'Authorization': `Api-Key ${apiKey}` } }
  );

  const now = DateTime.local().toISO();

  return {
    'event': {
      'header': {
        'namespace': 'Alexa',
        'name': 'Response',
        'messageId': uuid(),
        'correlationToken': request.directive.header.correlationToken,
        'payloadVersion': '3'
      },
      'endpoint': {
        'endpointId': endpointId,
      }
    },
    'context': {
      'properties': [
        {
          'namespace': 'Alexa.LockController',
          'name': 'lockState',
          'value': lock ? 'LOCKED' : 'UNLOCKED',
          'timeOfSample': now,
          'uncertaintyInMilliseconds': 0,
        }
      ]
    }
  };
}
