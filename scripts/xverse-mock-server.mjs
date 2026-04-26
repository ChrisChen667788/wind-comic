#!/usr/bin/env node
/**
 * XVERSE-Ent 本地 mock 服务器（OpenAI 兼容 chat-completions）
 *
 * 用途：
 *   - 在没有 GPU 的环境下，让你跑通 D8 全链路联调与 demo
 *   - CI 阶段验证 hybrid-orchestrator 的 XVerse 路由分支
 *
 * 启动:
 *   node scripts/xverse-mock-server.mjs           # 默认 :8000
 *   PORT=9000 node scripts/xverse-mock-server.mjs
 *
 * 配合 .env:
 *   XVERSE_ENABLED=true
 *   XVERSE_BASE_URL=http://localhost:8000/v1
 *   XVERSE_MODEL=xverse/XVERSE-Ent-A5.7B
 *
 * 行为：
 *   - 模型名包含 A4.2B → 返回纯文本镜头规划（Pass1）
 *   - 模型名包含 A5.7B → 返回完整 mock 剧本 JSON（Pass2）
 *   - 其他 → 回声 + 时间戳
 */
import http from 'http';

const PORT = Number(process.env.PORT || 8000);

function makeMockScript(shotCount = 5, hint = '默认创意') {
  const baseScene = '夜风掠过窗棂，烛火摇曳如心跳，远处传来悠长的钟鸣，铜炉里檀香未散，地面青砖透着微凉。';
  const baseAction = '左手按住腰间渗血的伤口，拖着右腿一步步挪向门口，背影在月光下颤抖，喉头滚动一声压抑的咳嗽';
  const basePrompt = 'cinematic 3D Chinese donghua style, volumetric god rays, dramatic chiaroscuro lighting, ornate hanfu costume, ' +
    'highly detailed face, intricate background architecture, octane render, 8k, atmospheric mist, ' +
    'strong silhouette, rim light, color grading teal and orange, motion blur, depth of field';
  const shots = Array.from({ length: shotCount }).map((_, i) => ({
    shotNumber: i + 1,
    act: i < shotCount / 3 ? 1 : i < (shotCount * 2) / 3 ? 2 : 3,
    storyBeat: ['激励事件', '渐进冲突', '中点反转', '黑暗时刻', '高潮抉择', '尾声余韵'][i % 6],
    sceneDescription: baseScene + `（镜头 ${i + 1}）`.padEnd(20, '。'),
    visualPrompt: basePrompt,
    characters: ['主角'],
    dialogue: i === 0 ? '走吧，天晚了。' : i === shotCount - 1 ? '我从未后悔。' : '别回头。',
    subtext: '我不想让你看到我在流泪',
    action: baseAction,
    emotion: ['悲', '怒', '惊', '决', '释'][i % 5],
    emotionTemperature: [-3, -7, 5, -10, 8][i % 5],
    beat: '从希望到失落',
    cameraWork: '推→拉→俯',
    soundDesign: '远雷+低吟+衣袂',
    duration: 8,
  }));
  return {
    title: `XVERSE 测试 · ${hint.slice(0, 6)}`,
    logline: '当落魄少年遭遇旧主反叛，他必须做出抉择，否则一切将被吞噬。',
    synopsis: '在风雨欲来的乱世，主角原本只想守护身边人。一次看似偶然的相遇打破了他的平静，将他卷入早已布好的局。'.repeat(2) +
      '面对内心欲望与不自觉的真正需求之间的撕裂，他被迫做出不可逆的选择。最终的高潮不是胜利，而是代价。'.repeat(2),
    theme: '自由的代价是孤独，因为真正的自由意味着对一切束缚的割舍',
    incitingIncident: '一封被火漆封印的密信被人塞进窗缝',
    emotionCurve: { overall: '中→低→希望→谷底→释', temperatures: [0, -3, 5, -8, 7] },
    characterArcs: [{
      name: '主角',
      arc: '从顺从到觉醒',
      desire: '回到旧日的安宁',
      need: '直面真相并放手',
      flaw: '过度责任感',
      paradox: '渴望自由却习惯服从',
      speechPattern: '简短，多用反问',
    }],
    shots,
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    return send(res, 200, {
      object: 'list',
      data: [
        { id: 'xverse/XVERSE-Ent-A5.7B', object: 'model', owned_by: 'xverse' },
        { id: 'xverse/XVERSE-Ent-A4.2B', object: 'model', owned_by: 'xverse' },
      ],
    });
  }

  if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf-8')); }
      catch { return send(res, 400, { error: 'bad json' }); }

      const model = String(body.model || '');
      const sys = String(body.messages?.find(m => m.role === 'system')?.content || '');
      const user = String(body.messages?.find(m => m.role === 'user')?.content || '');
      const isJson = body.response_format?.type === 'json_object';
      const isPlanning = sys.includes('精通分镜');
      const isFixer = sys.startsWith('你是一个 JSON 修复机');

      // 提取 minShots/maxShots 信号
      const m = sys.match(/(\d+)\s*[到-]\s*(\d+)\s*个镜头/);
      const wantMin = m ? Number(m[1]) : 5;

      let content;
      if (isFixer) {
        // 修复模式：返回最简但合法 JSON
        content = JSON.stringify({ title: 'fixed-mock', shots: [] });
      } else if (isPlanning || /A4\.2B/.test(model)) {
        // Pass1：纯文本规划
        const lines = [`共规划 ${wantMin} 个镜头`];
        for (let i = 1; i <= wantMin; i++) {
          lines.push(`镜头${i}: 场景${i} - 关键节拍${i} - 角色:主角 - 台词:"台词${i}"`);
        }
        content = lines.join('\n');
      } else if (isJson || /A5\.7B/.test(model)) {
        // Pass2：完整 JSON
        content = JSON.stringify(makeMockScript(wantMin, user.slice(0, 30)));
      } else {
        content = `[mock] echo: ${user.slice(0, 100)}`;
      }

      return send(res, 200, {
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: Math.ceil(sys.length / 4) + Math.ceil(user.length / 4),
          completion_tokens: Math.ceil(content.length / 4),
          total_tokens: Math.ceil((sys.length + user.length + content.length) / 4),
        },
      });
    });
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🎭 XVERSE mock server listening on http://localhost:${PORT}`);
  console.log(`   POST /v1/chat/completions  → mocked Pass1/Pass2/fixer`);
  console.log(`   GET  /v1/models            → A5.7B & A4.2B`);
});
