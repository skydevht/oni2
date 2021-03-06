/*
 * index.ts
 *
 * Entry for the external textmate tokenizer service
 */

import * as fs from "fs";
import * as rpc from "vscode-jsonrpc";
import * as vsctm from "vscode-textmate";

let connection = rpc.createMessageConnection(new rpc.StreamMessageReader(process.stdin), new rpc.StreamMessageWriter(process.stdout));

interface ITextmateInitData {
    [scope: string]: string;
};

let initializeNotification = new rpc.NotificationType<ITextmateInitData, void>('initialize');
let initializedNotification = new rpc.NotificationType<string, void>('initialized');
let exitNotification = new rpc.NotificationType<string, void>('exit');

let textmateGrammarPreloadNotification = new rpc.NotificationType<string, string>('textmate/preloadScope');
let textmateGrammarLoadedNotification = new rpc.NotificationType<string, void>('textmate/scopeLoaded');

type tokenResult = [number, number, string[]];

interface ITokenizeLineRequestParams {
    scopeName: string;
    line: string;
}

interface ITokenizeLineResponse {
    tokens: tokenResult[],
}

interface ISetThemeRequestParams {
    path: string;
}

let textmateTokenizeLineRequest = new rpc.RequestType<ITokenizeLineRequestParams, ITokenizeLineResponse, string, {}>('textmate/tokenizeLine');
let textmateSetThemeRequest = new rpc.RequestType<ISetThemeRequestParams, string[], string, {}>('textmate/setTheme');

let grammarPaths: ITextmateInitData = {};

const registry = new vsctm.Registry({
        loadGrammar: function (scopeName) {
            var path = grammarPaths[scopeName];
            if (path) {
                return new Promise((c,e) => {
                    fs.readFile(path, (error, content) => {
                        if (error) {
                            e(error);
                        } else {
                            var rawGrammar = vsctm.parseRawGrammar(content.toString(), path);
                            connection.sendNotification("textmate/scopeLoaded", scopeName);
                            c(rawGrammar);
                        }
                    });
                });
            } else  {
                return <any>null;
            }
        }
    });

connection.listen();

connection.onNotification(textmateGrammarPreloadNotification, (scope) => {
    registry.loadGrammar(scope);
});

connection.onNotification(initializeNotification, (paths: ITextmateInitData) => {
    grammarPaths = paths;
    connection.sendNotification(initializedNotification, {});
});

connection.onNotification(exitNotification, () => {
    process.exit(0);
});

connection.onRequest<ITokenizeLineRequestParams, ITokenizeLineResponse, string, {}>(textmateTokenizeLineRequest, (params) => {
    return registry.loadGrammar(params.scopeName).then((grammar) => {
       const tokens = grammar.tokenizeLine(params.line, <any>null);

        if (!tokens || !tokens.tokens) {
            return {
                tokens: [],
            }
        } else {
            const colors = grammar.tokenizeLine2(params.line, <any>null);
            const parsedTokens = tokens.tokens;
            const filteredTokens = parsedTokens.filter((t) => t.scopes.length > 1);
            const result: tokenResult[] = filteredTokens.map((t) => [t.startIndex, t.endIndex, t.scopes] as tokenResult);

            const colorTokens = Array.prototype.slice.call(colors.tokens);
            return {
                tokens: result,
                colors: colorTokens,
            };
        }

    });
});

connection.onRequest<ISetThemeRequestParams, string[], string, {}>(textmateSetThemeRequest, (params) => {
    let themeFile = fs.readFileSync(params.path);
    let parsedTheme = JSON.parse(themeFile.toString("utf8"));

    let rawTheme: vsctm.IRawTheme = {
        name: parsedTheme.name,
        settings: parsedTheme.tokenColors || [],
    };

    registry.setTheme(rawTheme);
    const precolors = registry.getColorMap();
    const colors = precolors.filter((c) => !!c);
    return colors;
})
