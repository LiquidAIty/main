"""Disposable real SDK-2 protocol peer; no application state or model calls."""
import sys
from mcp.server import MCPServer
from mcp.types import CallToolResult, TextContent

server = MCPServer('lumibot-compatibility-peer', log_level='ERROR')

@server.tool()
def multiply(a: int, b: int) -> dict:
    return {'value': a * b}

@server.tool()
def refuse() -> CallToolResult:
    return CallToolResult(content=[TextContent(text='deliberate tool refusal')], is_error=True)

if len(sys.argv) == 1:
    server.run()
else:
    import uvicorn
    from starlette.responses import JSONResponse
    app = server.streamable_http_app(stateless_http=True)
    async def authenticated(scope, receive, send):
        if scope['type'] == 'http' and dict(scope.get('headers', [])).get(b'authorization') != b'Bearer acceptance-only':
            return await JSONResponse({'error': 'authorization_required'}, status_code=401)(scope, receive, send)
        return await app(scope, receive, send)
    uvicorn.run(authenticated, host='127.0.0.1', port=int(sys.argv[1]), log_level='error')
