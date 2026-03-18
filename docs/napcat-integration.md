# NapCat (QQ) Reverse WebSocket Integration

This daemon can accept NapCat OneBot v11 reverse WebSocket connections.

## Endpoint
- ws://127.0.0.1:6127/onebot/v11/ws

## Authentication (Optional)
If you set a token, the bridge will require it.

Environment variable:
- IKI_NAPCAT_ACCESS_TOKEN (or IKI_NAPCAT_TOKEN)

NapCat reverse WS should connect with:
- Query param: access_token=<token>
  - Example: ws://127.0.0.1:6127/onebot/v11/ws?access_token=YOUR_TOKEN

## Provider Selection
The bridge uses the first enabled provider and its first model by default.
Override with:
- IKI_NAPCAT_PROVIDER (provider type, e.g. openai)
- IKI_NAPCAT_MODEL (model id)

## Tool Use
Tools are disabled by default.
Enable by setting a comma list:
- IKI_NAPCAT_TOOLS=web,fetch

## Group Mention Gate (Optional)
Require mention in group chats to respond:
- IKI_NAPCAT_REQUIRE_MENTION=true

## Behavior
- Each QQ conversation maps to a deterministic thread:
  - napcat_<self_id>_private_<user_id>
  - napcat_<self_id>_group_<group_id>
- Incoming messages are stored in the chat DB; replies are generated and stored.
- Replies are sent via OneBot actions:
  - send_private_msg
  - send_group_msg
