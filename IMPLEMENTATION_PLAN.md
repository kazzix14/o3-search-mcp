# o3-search-mcp n段階ループ実装

## 実装概要

固定2段階から動的n段階ループへの変更。既存の `index.ts` を直接修正してシンプルに実装。

## 主な変更点

### 1. n段階ループの実装
- `tool_choice: "auto"` に変更
- while ループで最大10回まで実行
- 各段階でツール結果を蓄積

### 2. 完了判定の修正
- ❌ 旧: function callがない場合のみ完了
- ✅ 新: **function callがなく、かつテキスト出力がある場合のみ完了**

### 3. ツール結果の表示
- 各段階のツール結果を蓄積
- 最終レスポンスにツール使用履歴を追加

## 実装したコード

```typescript
// N-stage loop: Continue until text response is returned
let responseText = "";
let allToolResults: string[] = [];
let currentInput = fullInput;
let depth = 0;
const maxDepth = 10;

while (depth < maxDepth) {
  depth++;
  
  const response = await openai.responses.create({
    model: "o3",
    input: currentInput,
    tools: tools,
    tool_choice: "auto",  // 変更: "required" から "auto" へ
    parallel_tool_calls: true,
    reasoning: { effort: reasoningEffort },
  });

  // ツール実行処理...
  
  // 完了判定: function callがなく、かつテキスト出力がある場合のみ完了
  if (!hasFunctionCalls && currentResponseText.trim().length > 0) {
    responseText = currentResponseText;
    break;
  }
  
  // ツール結果を次のループに渡す
  currentInput = `${fullInput}

**Tool Results:**
${allToolResults.join('\n\n')}

上記の結果を踏まえて、さらにツールが必要なら実行し、十分な情報が揃ったら最終的な分析・回答をしてください。`;
}
```

## 現在の状況

✅ **完了済み**
- n段階ループの基本実装
- tool_choice: "auto" への変更
- 完了判定ロジックの修正（テキスト出力の存在確認）
- previous_response_idを使った会話継続性の改善（thinking tokenとassistantメッセージを自動引き継ぎ）

🔄 **次のステップ**
- テスト実行（様々なシナリオで動作確認）
- 必要に応じて安全制限の追加検討

### 改善点の実装

**previous_response_id による会話継続性の改善**
```typescript
let lastResponseId: string | undefined;

while (depth < maxDepth) {
  const response = await openai.responses.create({
    // ... 他のパラメータ ...
    ...(lastResponseId && { previous_response_id: lastResponseId }),
  });
  
  // レスポンスIDを保存
  lastResponseId = response.id;
}
```

これにより：
- thinking token（推論過程）が自動的に次のループに引き継がれる
- 前段のassistantメッセージも保持される
- トークンの重複が減り、コスト効率が向上

## 期待される効果

- o3がより自由にツールを使える
- 複雑なタスクを自動で完了まで実行
- 適切な完了判定で無駄なループを防止