# alexa-skill-lambda-smartlock
Alexa Smart Home Skill Smart Lock

## 概要
[jema-smartlock](https://github.com/nana4rider/jema-smartlock)のRESTful APIと接続し、
Alexaの[ロックデバイス](https://developer.amazon.com/ja-JP/docs/alexa/smarthome/build-smart-home-skills-for-locks.html)として認識させるプログラムです。

## フロー

```mermaid
sequenceDiagram
  participant lk as 電子錠
  participant js as JEM-A SmartLock
  participant ax as Alexa
  participant lm as AWS Lambda

  Note over lk, lm: Alexaから解錠/施錠
  ax ->> lm : 施錠/解錠命令
  lm ->> js : HTTPリクエスト
  js ->> lk : 制御信号
  js ->> lm : HTTPレスポンス
  lm ->> ax : 状態レポート

  Note over lk, lm: ロック状態を取得
  ax ->> lm : 状態取得命令
  lm ->> js : HTTPリクエスト
  js ->> lk : モニタ信号要求
  lk ->> js : モニタ信号取得
  js ->> lm : HTTPレスポンス
  lm ->> ax : 状態レポート
```

## DynamoDB
テーブル名`alexa_home_lock_devices`で下記データを作成
```json
{
  "id": {
    "S": "デバイスID(任意)"
  },
  "apiUrl": {
    "S": "jema-smartlockのRESTful APIのURL"
  },
  "apiKey": {
    "S": "jema-smartlockのRESTful APIのAPIキー"
  },
  "name": {
    "S": "デバイス名(任意)"
  }
}
```
