# Bao Cao Phan Tich Repo `mindcraft`

- Ngay phan tich: 2026-03-13
- Thu muc duoc quet: `e:\mindscraft-ver-remake-main`
- Pham vi: toan bo file trong repo, phan tich sau cho code/module/cau hinh/tai lieu/test/script; cac file du lieu JSON so luong lon duoc gom theo nhom thay vi dien giai tung record du lieu.
- Loai tru khoi doc sau: `.git/`, `node_modules/`, cac file log/runtime artifact chi ghi nhan o muc hien trang.

## 1. Tom tat dieu hanh

Day la mot repo Node.js ESM de chay bot Minecraft dua tren Mineflayer, co 4 lop kien truc ro:

1. `MindServer` va UI de quan ly agent.
2. Moi agent chay thanh process rieng, noi voi `MindServer` qua Socket.IO.
3. Tang model/prompt/profile de noi chuyen, code, vision.
4. Tang skill/task/world de cho bot tuong tac Minecraft va chay benchmark.

Danh gia thuc te:

- Diem manh:
  - Phan tach module kha ro giua runtime, model, task, world, ui.
  - Co patch-package cho dependency bug.
  - Co profile validation va chong path traversal o mot so diem nhap quan trong.
  - Co benchmark/task asset kha day dan.
  - Co spatial memory, command parser va task benchmark theo huong nghien cuu.
- Diem yeu nghiem trong:
  - `ActionManager` hien tai lam loi o duong thanh cong, bien action thanh exception gia.
  - `!newAction` / sandbox code co bug wiring endowment, kha nang cao la khong chay dung.
  - He provider/model, README, profile va test dang lech nhau rat manh.
  - `Task` xu ly danh sach agent sai kieu du lieu, anh huong teleport/goal/clear inventory.
  - Mot phan test dang "xanh gia" tren Windows vi test runner khong thuc su chay.
  - Tai lieu `BOT_GUIDE.md` mo ta ca tinh nang chua thay co trong source hien tai.

Ket luan ngan:

- Repo nay dang o trang thai "research prototype / local customized fork", chua o muc "production-ready".
- Co the hoc cau truc, mo rong va chay mot so luong cong viec cu the.
- Neu dung de chay thuc chien, nen uu tien sua 5 nhom loi o muc "Critical/High" truoc.

## 2. Tong quan inventory

Tong so file (khong tinh `.git` va `node_modules`): `217`

| Loai file | So luong |
|---|---:|
| `.json` | 87 |
| `.js` | 81 |
| `.py` | 16 |
| `.md` | 11 |
| `.patch` | 7 |
| `.txt` | 4 |
| `.sh` | 2 |
| Khong extension | 2 |
| `.pdf` | 1 |
| `.html` | 1 |
| `.yml` | 1 |
| `.Dockerfile` | 1 |
| `.log` | 1 |

Nhan xet:

- Repo nghieng manh ve code JS/JSON.
- JSON chia thanh 3 loai: profiles, tasks/datasets, construction blueprint.
- Python duoc dung chu yeu cho benchmark/evaluation/generate task, khong phai runtime chinh.

## 3. Kiem tra thuc te da chay

### 3.1 Smoke check

- `node main.js --help`: chay duoc, parser CLI on.
- `node --test tests/tier8/config_validation.test.js`: pass `24/24`.

### 3.2 Test reality

- `tests/tier2/*.test.js`, `tests/tier4/*.test.js` khi chay truc tiep bang `node ...` tren Windows khong in gi ca.
- Nguyen nhan: nhieu file test dung dieu kien:
  - `tests/tier2/world.test.js:149`
  - `tests/tier2/mcdata.test.js:134`
  - `tests/tier2/tasks.test.js:198`
  - `tests/tier4/models.test.js:423`
  - `tests/tier4/providers.test.js:358`
  - deu so sanh `import.meta.url === \`file://${process.argv[1]}\``
- Tren Windows, `import.meta.url` la dang `file:///E:/...`, con `process.argv[1]` la dang path Windows, nen so sanh nay thuong false.
- Nghia la mot phan test dang "pass gia" don gian vi khong chay.

### 3.3 Lint reality

`npx eslint src main.js settings.js` tra ve `243` loi.

Phan tach thuc te:

- Loi "that":
  - bien chua khai bao (`timedout`, `prev_health`, `res`, `bot`...),
  - API goi toi method khong ton tai,
  - floating promise,
  - sai property (`agent_id` vs `count_id`),
  - logic khong nhat quan.
- Loi do config lint lech:
  - `eslint.config.js` set `globals.browser`, khong co `process`, `Buffer`, `global`, `Compartment`.
  - `ecmaVersion: 2021` khong theo kip source dang dung static class field va top-level await.

### 3.4 Provider/profile resolution reality

Ket qua resolve truc tiep tu `src/models/_model_map.js`:

| Profile | Ket qua thuc te |
|---|---|
| `gpt.json` | OK -> `openai` |
| `claude.json` | OK -> `anthropic` |
| `gemini.json` | OK -> `google` |
| `deepseek.json` | OK nhung bi map vao `openai` compatible mode |
| `freeguy.json` | Sai provider: `groq/llama-3.3-70b-versatile` bi map thanh `ollama` |
| `llama.json` | Sai provider giong `freeguy.json` |
| `grok.json` | Loi: `Unknown model: grok-3-mini-latest` |
| `mistral.json` | Loi: `Unknown model: mistral/mistral-large-latest` |
| `mercury.json` | Loi: `Unknown model: mercury/mercury-coder-small` |
| `qwen.json` | Loi: `Unknown api` |
| `vllm.json` | Loi: `Unknown api` |
| `azure.json` | Loi: `Unknown api` |

Thuc chat, repo hien chi con cac adapter model sau:

- `gpt.js`
- `claude.js`
- `gemini.js`
- `ollama.js`
- `openrouter.js`
- `prompter.js`
- `_model_map.js`

Trong khi README va test tier4 van ky vong rat nhieu provider hon.

## 4. Findings quan trong

### Critical

1. `src/agent/action_manager.js:146-156`
   - Dung cac bien `timedout`, `interrupted`, `semanticFailure`, `output` ma khong khai bao.
   - Da xac nhan bang chay truc tiep: action thanh cong van bi catch thanh `ReferenceError: timedout is not defined`.
   - Tac dong: toan bo action pipeline co nguy co bao loi gia, lam sai feedback cho LLM, mode va command layer.

2. `src/agent/coder.js:238` + `src/agent/library/lockdown.js:86`
   - `makeCompartment(bot, endowments)` bi goi sai, coder truyen endowments vao tham so `bot`.
   - Da xac nhan bang thuc nghiem nho: code trong compartment goi `log(...)` se ra `log is not a function`.
   - Tac dong: `!newAction` va code generation sandbox co kha nang cao khong dung duoc dung nhu thiet ke.

3. `src/agent/tasks/tasks.js:330` va cac vi tri su dung `available_agents`
   - `updateAvailableAgents(agents)` luu nguyen object `{name, in_game, ...}`.
   - Nhung cac noi sau lai xu ly no nhu string:
     - `tasks.js:397` -> `/clear ${agent}`
     - `tasks.js:427` -> `.filter(n => n !== this.name).join(', ')`
     - `tasks.js:515` -> tim `other_name`
     - `tasks.js:561` -> so sanh voi `playerName`
     - `tasks.js:575` -> `/tp ${this.name} ${this.available_agents[0]}`
   - Tac dong: coordination task, teleport, clear inventory, conversation init co the sai ngay khi co nhieu bot.

### High

4. `src/models/_model_map.js:58` va toan bo thu muc `profiles/`
   - He heuristics map model qua prefix dang roi vao tinh trang stale.
   - Vi du:
     - `grok` khong duoc nhan.
     - `groq/llama...` bi nhan nham thanh `ollama` vi co chu `llama`.
   - README van cong bo ho tro `xai`, `qwen`, `mistral`, `groq`, `vllm`, `mercury`... nhung source khong con adapter tuong ung.

5. `src/agent/npc/controller.js:96`
   - Goi `this.agent.prompter.promptGoalSetting(...)` nhung trong `src/models/prompter.js` khong co method nay.
   - Ngoai ra `NPCContoller` chi duoc tao o `src/agent/agent.js:50`, nhung khong thay `npc.init()` duoc goi.
   - Tac dong: subsystem NPC dang o trang thai chua noi day du, nhieu kha nang "dead code".

6. `src/agent/library/world.js:539-641`
   - Cong bo API learned action:
     - `getLearnedActions`
     - `saveLearnedAction`
     - `runLearnedAction`
     - `getLearnedActionMetadata`
     - `getLearnedActionRecommendations`
   - Nhung trong `src/agent/coder.js` khong co cac method nay.
   - Tac dong: docs/API goi y tinh nang hoc lai action, nhung runtime hien tai khong co implementation.

7. `src/agent/commands/queries.js:452-461`
   - Lenh reflex tham chieu `agent.reflex_architect`, `agent.damage_logger`, `agent.reflex_loader`.
   - Khong thay khoi tao cac thanh phan nay trong `Agent`.
   - Tac dong: command ton tai trong docs nhung goi vao se vo.

8. `src/agent/agent.js:506-513`
   - Listener `health` dung `prev_health` nhung khong khai bao/khong khoi tao.
   - Tac dong: event health co the nem exception ngay lan dau bot nhan damage/heal.

9. `src/agent/tasks/tasks.js:617`
   - Dung `this.agent.agent_id` thay vi `this.agent.count_id`.
   - Tac dong: branch xu ly human player trong construction task khong chay dung.

10. `src/agent/tasks/tasks.js:426` va `:472-473`
   - `this.data.human_count` khong co default.
   - O mot so noi lai dung `this.human_count` thay vi `this.data.human_count`.
   - Tac dong: de phat sinh branch sai/NaN trong task co human player.

### Medium

11. `main.js:30-31`
   - `task_path` doc thang bang `readFileSync(args.task_path, 'utf8')`.
   - Khong dung `sanitizeFilePath` va `safeJsonParse` nhu profile.
   - Tac dong: khong dong deu ve validation input, nhat la khi script benchmark truyen file ben ngoai.

12. `src/mindcraft/public/settings_spec.json` lech `settings.js`
   - `settings.js` co nhieu key runtime khong co trong spec:
     - `mindserver_port`, `auto_open_ui`, `profiles`, `allow_insecure_reflexes`, `compact_prompt_context`, `prompt_stats_max_lines`, `prompt_stats_max_chars`, `prompt_command_docs_compact`, `prompt_command_docs_max_entries`, `block_place_delay`, `recursive_task_max_depth`, `reflex_max_active_handlers`
   - `settings_spec.json` lai co `profile`, `task` khong nam trong `settings.js`.
   - Tac dong: UI/API create-agent khong dai dien day du runtime thuc te.

13. `eslint.config.js`
   - Dang config theo browser + ES2021.
   - Repo thuc te la Node ESM.
   - Tac dong: lint noise rat lon, che mat loi that va giam tin cay CI.

14. `BOT_GUIDE.md`
   - Mo ta `ReflexLoader`, `Task Tree`, `Confidence`, `HealthGate`.
   - Trong source hien tai khong thay implementation dong bo.
   - Tac dong: tai lieu onboarding de gay hieu nham.

15. Nhieu comment/chuoi bi loi encoding va tron ngon ngu
   - Xuat hien trong `prompter.js`, `modes.js`, `memory_bank.js`, docs...
   - Tac dong: kho maintain, kho tim loi va giam chat luong prompt/doc.

