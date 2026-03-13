diff --git a/e:\mindscraft-ver-remake-main\BAO_CAO_PHAN_TICH_REPO.md b/e:\mindscraft-ver-remake-main\BAO_CAO_PHAN_TICH_REPO.md
new file mode 100644
--- /dev/null
+++ b/e:\mindscraft-ver-remake-main\BAO_CAO_PHAN_TICH_REPO.md
@@ -0,0 +1,552 @@
+# Bao Cao Phan Tich Repo `mindcraft`
+
+- Ngay phan tich: 2026-03-13
+- Thu muc duoc quet: `e:\mindscraft-ver-remake-main`
+- Pham vi: toan bo file trong repo, phan tich sau cho code/module/cau hinh/tai lieu/test/script; cac file du lieu JSON so luong lon duoc gom theo nhom thay vi dien giai tung record du lieu.
+- Loai tru khoi doc sau: `.git/`, `node_modules/`, cac file log/runtime artifact chi ghi nhan o muc hien trang.
+
+## 1. Tom tat dieu hanh
+
+Day la mot repo Node.js ESM de chay bot Minecraft dua tren Mineflayer, co 4 lop kien truc ro:
+
+1. `MindServer` va UI de quan ly agent.
+2. Moi agent chay thanh process rieng, noi voi `MindServer` qua Socket.IO.
+3. Tang model/prompt/profile de noi chuyen, code, vision.
+4. Tang skill/task/world de cho bot tuong tac Minecraft va chay benchmark.
+
+Danh gia thuc te:
+
+- Diem manh:
+  - Phan tach module kha ro giua runtime, model, task, world, ui.
+  - Co patch-package cho dependency bug.
+  - Co profile validation va chong path traversal o mot so diem nhap quan trong.
+  - Co benchmark/task asset kha day dan.
+  - Co spatial memory, command parser va task benchmark theo huong nghien cuu.
+- Diem yeu nghiem trong:
+  - `ActionManager` hien tai lam loi o duong thanh cong, bien action thanh exception gia.
+  - `!newAction` / sandbox code co bug wiring endowment, kha nang cao la khong chay dung.
+  - He provider/model, README, profile va test dang lech nhau rat manh.
+  - `Task` xu ly danh sach agent sai kieu du lieu, anh huong teleport/goal/clear inventory.
+  - Mot phan test dang "xanh gia" tren Windows vi test runner khong thuc su chay.
+  - Tai lieu `BOT_GUIDE.md` mo ta ca tinh nang chua thay co trong source hien tai.
+
+Ket luan ngan:
+
+- Repo nay dang o trang thai "research prototype / local customized fork", chua o muc "production-ready".
+- Co the hoc cau truc, mo rong va chay mot so luong cong viec cu the.
+- Neu dung de chay thuc chien, nen uu tien sua 5 nhom loi o muc "Critical/High" truoc.
+
+## 2. Tong quan inventory
+
+Tong so file (khong tinh `.git` va `node_modules`): `217`
+
+| Loai file | So luong |
+|---|---:|
+| `.json` | 87 |
+| `.js` | 81 |
+| `.py` | 16 |
+| `.md` | 11 |
+| `.patch` | 7 |
+| `.txt` | 4 |
+| `.sh` | 2 |
+| Khong extension | 2 |
+| `.pdf` | 1 |
+| `.html` | 1 |
+| `.yml` | 1 |
+| `.Dockerfile` | 1 |
+| `.log` | 1 |
+
+Nhan xet:
+
+- Repo nghieng manh ve code JS/JSON.
+- JSON chia thanh 3 loai: profiles, tasks/datasets, construction blueprint.
+- Python duoc dung chu yeu cho benchmark/evaluation/generate task, khong phai runtime chinh.
+
+## 3. Kiem tra thuc te da chay
+
+### 3.1 Smoke check
+
+- `node main.js --help`: chay duoc, parser CLI on.
+- `node --test tests/tier8/config_validation.test.js`: pass `24/24`.
+
+### 3.2 Test reality
+
+- `tests/tier2/*.test.js`, `tests/tier4/*.test.js` khi chay truc tiep bang `node ...` tren Windows khong in gi ca.
+- Nguyen nhan: nhieu file test dung dieu kien:
+  - `tests/tier2/world.test.js:149`
+  - `tests/tier2/mcdata.test.js:134`
+  - `tests/tier2/tasks.test.js:198`
+  - `tests/tier4/models.test.js:423`
+  - `tests/tier4/providers.test.js:358`
+  - deu so sanh `import.meta.url === \`file://${process.argv[1]}\``
+- Tren Windows, `import.meta.url` la dang `file:///E:/...`, con `process.argv[1]` la dang path Windows, nen so sanh nay thuong false.
+- Nghia la mot phan test dang "pass gia" don gian vi khong chay.
+
+### 3.3 Lint reality
+
+`npx eslint src main.js settings.js` tra ve `243` loi.
+
+Phan tach thuc te:
+
+- Loi "that":
+  - bien chua khai bao (`timedout`, `prev_health`, `res`, `bot`...),
+  - API goi toi method khong ton tai,
+  - floating promise,
+  - sai property (`agent_id` vs `count_id`),
+  - logic khong nhat quan.
+- Loi do config lint lech:
+  - `eslint.config.js` set `globals.browser`, khong co `process`, `Buffer`, `global`, `Compartment`.
+  - `ecmaVersion: 2021` khong theo kip source dang dung static class field va top-level await.
+
+### 3.4 Provider/profile resolution reality
+
+Ket qua resolve truc tiep tu `src/models/_model_map.js`:
+
+| Profile | Ket qua thuc te |
+|---|---|
+| `gpt.json` | OK -> `openai` |
+| `claude.json` | OK -> `anthropic` |
+| `gemini.json` | OK -> `google` |
+| `deepseek.json` | OK nhung bi map vao `openai` compatible mode |
+| `freeguy.json` | Sai provider: `groq/llama-3.3-70b-versatile` bi map thanh `ollama` |
+| `llama.json` | Sai provider giong `freeguy.json` |
+| `grok.json` | Loi: `Unknown model: grok-3-mini-latest` |
+| `mistral.json` | Loi: `Unknown model: mistral/mistral-large-latest` |
+| `mercury.json` | Loi: `Unknown model: mercury/mercury-coder-small` |
+| `qwen.json` | Loi: `Unknown api` |
+| `vllm.json` | Loi: `Unknown api` |
+| `azure.json` | Loi: `Unknown api` |
+
+Thuc chat, repo hien chi con cac adapter model sau:
+
+- `gpt.js`
+- `claude.js`
+- `gemini.js`
+- `ollama.js`
+- `openrouter.js`
+- `prompter.js`
+- `_model_map.js`
+
+Trong khi README va test tier4 van ky vong rat nhieu provider hon.
+
+## 4. Findings quan trong
+
+### Critical
+
+1. `src/agent/action_manager.js:146-156`
+   - Dung cac bien `timedout`, `interrupted`, `semanticFailure`, `output` ma khong khai bao.
+   - Da xac nhan bang chay truc tiep: action thanh cong van bi catch thanh `ReferenceError: timedout is not defined`.
+   - Tac dong: toan bo action pipeline co nguy co bao loi gia, lam sai feedback cho LLM, mode va command layer.
+
+2. `src/agent/coder.js:238` + `src/agent/library/lockdown.js:86`
+   - `makeCompartment(bot, endowments)` bi goi sai, coder truyen endowments vao tham so `bot`.
+   - Da xac nhan bang thuc nghiem nho: code trong compartment goi `log(...)` se ra `log is not a function`.
+   - Tac dong: `!newAction` va code generation sandbox co kha nang cao khong dung duoc dung nhu thiet ke.
+
+3. `src/agent/tasks/tasks.js:330` va cac vi tri su dung `available_agents`
+   - `updateAvailableAgents(agents)` luu nguyen object `{name, in_game, ...}`.
+   - Nhung cac noi sau lai xu ly no nhu string:
+     - `tasks.js:397` -> `/clear ${agent}`
+     - `tasks.js:427` -> `.filter(n => n !== this.name).join(', ')`
+     - `tasks.js:515` -> tim `other_name`
+     - `tasks.js:561` -> so sanh voi `playerName`
+     - `tasks.js:575` -> `/tp ${this.name} ${this.available_agents[0]}`
+   - Tac dong: coordination task, teleport, clear inventory, conversation init co the sai ngay khi co nhieu bot.
+
+### High
+
+4. `src/models/_model_map.js:58` va toan bo thu muc `profiles/`
+   - He heuristics map model qua prefix dang roi vao tinh trang stale.
+   - Vi du:
+     - `grok` khong duoc nhan.
+     - `groq/llama...` bi nhan nham thanh `ollama` vi co chu `llama`.
+   - README van cong bo ho tro `xai`, `qwen`, `mistral`, `groq`, `vllm`, `mercury`... nhung source khong con adapter tuong ung.
+
+5. `src/agent/npc/controller.js:96`
+   - Goi `this.agent.prompter.promptGoalSetting(...)` nhung trong `src/models/prompter.js` khong co method nay.
+   - Ngoai ra `NPCContoller` chi duoc tao o `src/agent/agent.js:50`, nhung khong thay `npc.init()` duoc goi.
+   - Tac dong: subsystem NPC dang o trang thai chua noi day du, nhieu kha nang "dead code".
+
+6. `src/agent/library/world.js:539-641`
+   - Cong bo API learned action:
+     - `getLearnedActions`
+     - `saveLearnedAction`
+     - `runLearnedAction`
+     - `getLearnedActionMetadata`
+     - `getLearnedActionRecommendations`
+   - Nhung trong `src/agent/coder.js` khong co cac method nay.
+   - Tac dong: docs/API goi y tinh nang hoc lai action, nhung runtime hien tai khong co implementation.
+
+7. `src/agent/commands/queries.js:452-461`
+   - Lenh reflex tham chieu `agent.reflex_architect`, `agent.damage_logger`, `agent.reflex_loader`.
+   - Khong thay khoi tao cac thanh phan nay trong `Agent`.
+   - Tac dong: command ton tai trong docs nhung goi vao se vo.
+
+8. `src/agent/agent.js:506-513`
+   - Listener `health` dung `prev_health` nhung khong khai bao/khong khoi tao.
+   - Tac dong: event health co the nem exception ngay lan dau bot nhan damage/heal.
+
+9. `src/agent/tasks/tasks.js:617`
+   - Dung `this.agent.agent_id` thay vi `this.agent.count_id`.
+   - Tac dong: branch xu ly human player trong construction task khong chay dung.
+
+10. `src/agent/tasks/tasks.js:426` va `:472-473`
+   - `this.data.human_count` khong co default.
+   - O mot so noi lai dung `this.human_count` thay vi `this.data.human_count`.
+   - Tac dong: de phat sinh branch sai/NaN trong task co human player.
+
+### Medium
+
+11. `main.js:30-31`
+   - `task_path` doc thang bang `readFileSync(args.task_path, 'utf8')`.
+   - Khong dung `sanitizeFilePath` va `safeJsonParse` nhu profile.
+   - Tac dong: khong dong deu ve validation input, nhat la khi script benchmark truyen file ben ngoai.
+
+12. `src/mindcraft/public/settings_spec.json` lech `settings.js`
+   - `settings.js` co nhieu key runtime khong co trong spec:
+     - `mindserver_port`, `auto_open_ui`, `profiles`, `allow_insecure_reflexes`, `compact_prompt_context`, `prompt_stats_max_lines`, `prompt_stats_max_chars`, `prompt_command_docs_compact`, `prompt_command_docs_max_entries`, `block_place_delay`, `recursive_task_max_depth`, `reflex_max_active_handlers`
+   - `settings_spec.json` lai co `profile`, `task` khong nam trong `settings.js`.
+   - Tac dong: UI/API create-agent khong dai dien day du runtime thuc te.
+
+13. `eslint.config.js`
+   - Dang config theo browser + ES2021.
+   - Repo thuc te la Node ESM.
+   - Tac dong: lint noise rat lon, che mat loi that va giam tin cay CI.
+
+14. `BOT_GUIDE.md`
+   - Mo ta `ReflexLoader`, `Task Tree`, `Confidence`, `HealthGate`.
+   - Trong source hien tai khong thay implementation dong bo.
+   - Tac dong: tai lieu onboarding de gay hieu nham.
+
+15. Nhieu comment/chuoi bi loi encoding va tron ngon ngu
+   - Xuat hien trong `prompter.js`, `modes.js`, `memory_bank.js`, docs...
+   - Tac dong: kho maintain, kho tim loi va giam chat luong prompt/doc.
+
+## 5. Phan tich module theo thu muc
+
+## 5.1 Top-level runtime, config, docs
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `main.js` | Entry CLI, nap profile/task, override env, tao agent | Co profile validation, env override ro | `task_path` chua sanitize/parse safe; lint no-undef do config | Tot ve luong khoi dong, can siet input task |
+| `settings.js` | Cau hinh runtime local cua fork nay | Nhieu flag de tune prompt, coding, reflex, task | Dang bat `allow_insecure_coding: true`, `allow_insecure_reflexes: true`, `log_all_prompts: true`; port `5000` lech README; mang tinh local customization | Co gia tri thuc dung, nhung nguy co an toan/khong portable |
+| `package.json` | Dinh nghia dependency runtime | Du ecosystem Mineflayer + multi-model | Khong co script test/lint; danh sach dep lon, bao tri nang | Dung duoc, thieu hygiene build |
+| `eslint.config.js` | Lint config | Da co plugin `no-floating-promise` | Config sai target Node ESM, gay 243 loi va parsing error gia | Nen sua som de lint co y nghia |
+| `Dockerfile` | Container runtime chinh | Co goi native dep cho canvas/webgl | Van chay `npm install` full trong image, chua toi uu layer | Dung duoc cho sandbox/local |
+| `docker-compose.yml` | Dev compose + viaproxy profile | Mount `settings.js`, `keys.json`, `profiles`, `bots` kha hop ly | Khong enforce secret handling; port comments chua chuan hoa | Tot cho local dev |
+| `Tasks.Dockerfile` | Anh phuc vu benchmark/task | Co Java, Python, AWS CLI, tmux | Rat nang, noi suy benchmark cu, clone repo tu xa trong build | Script nghien cuu hon la production |
+| `README.md` | Onboarding chinh | Giai thich install/chay/profile/task kha day du | Bang provider stale so voi code hien tai | Tot cho tong quan, khong con khop hoan toan voi source |
+| `BOT_GUIDE.md` | Huong dan tieng Viet rat chi tiet | De doc, phu hop onboarding nguoi moi | Co nhieu phan mo ta tinh nang chua thay ton tai trong source | Tai lieu huu ich nhung khong nen tin 100% |
+| `FAQ.md` | Goi y xu ly loi | Co gia tri support | Khong doi chieu voi fork local nay | Huu ich |
+| `minecollab.md` | Huong dan benchmark MineCollab | Bao quat workflow task/eval | Lech mot phan voi fork hien tai | Huu ich cho research |
+| `AGENT_RULES.md` | Rulebook local cho agent/code style | Ra quy tac ro, chan fake code | Mot so feature duoc noi toi trong doc khong co du code | Huu ich cho quy trinh, khong phai source of truth tuyet doi |
+| `keys.example.json` | Mau secret | Dung cho onboarding | Khong rang buoc schema | On |
+| `err.txt`, `err8.txt`, `error.log`, `output_utf8.txt` | Runtime artifact | Co gia tri forensic | Khong nen coi la module chinh | Artifact |
+| `TIER2_FIXES.patch` | Patch/ghi chu fix rieng | Ghi dau vet lich su sua | Khong thuoc luong runtime chinh | Artifact |
+
+## 5.2 `src/mindcraft` va `src/process`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/mindcraft/mindcraft.js` | Orchestrator tao `MindServer`, spawn agent process, shutdown | Kien truc process ro, co free index de tranh exhaust port viewer | `async init` khong can async; con phu thuoc chua chat vao `process.exit` | Kha on cho orchestration |
+| `src/mindcraft/mindserver.js` | Socket hub + web UI + resource lock | Trung tam hoa giao tiep agent/UI kha sach | Resource lock in-memory, khong persistent; mot so event assume socket ton tai | Module quan trong, kha tot |
+| `src/mindcraft/mcserver.js` | Ping/find Minecraft server | Tu dong detect version/LAN co gia tri thuc te | Quet port tuan tu co the cham; `async` thua o `serverInfo` | Dung duoc |
+| `src/mindcraft/public/index.html` | UI quan tri agent | UI du thong tin, co control va viewer | HTML/CSS/JS monolith, thiet ke da cu, spec setting lech runtime | Admin UI dung duoc, kho mo rong |
+| `src/mindcraft/public/settings_spec.json` | Schema cho UI create-agent | Co mo ta type/default | Lech `settings.js` va khong theo kip local fork | Nen dong bo lai |
+| `src/process/agent_process.js` | Spawn/restart child process | Co restart/backoff, force restart | Dung `process.exit` ben parent khi code child > 1, coupling hoi manh | Dung duoc |
+| `src/process/init_agent.js` | Bootstrap child -> connect mindserver -> start Agent | Gon, de theo doi | Co floating promise/lint issue nho | Tot |
+
+## 5.3 `src/models`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/models/_model_map.js` | Tu dong scan adapter, chon API, tao model | Y tuong dong adapter dep | Heuristic stale, misclassify provider, test/doc lech code; khong co adapter cho nhieu profile co san | Mot trong cac diem gay roi nhieu nhat hien tai |
+| `src/models/prompter.js` | Merge profile, init model, examples, skill docs, build prompt | Day la trung tam prompt pipeline, co compact context | File lon, nhieu trach nhiem, co comment loi encoding; NPC goi method khong ton tai; prompt layer phu thuoc settings global | Quan trong va kha gia tri, can tach nho sau |
+| `src/models/gpt.js` | Adapter OpenAI/OpenAI-compatible + TTS | Ho tro Responses API va custom baseURL, strip think tag | SDK cu (`openai` 4.4.0), phan custom URL/Responses branch can test them hon | Tot trong nhom adapter con song |
+| `src/models/gemini.js` | Adapter Google Gemini + TTS | Ho tro text, vision, embed, TTS | Error handling va API shape can test lai voi SDK moi | Tot |
+| `src/models/claude.js` | Adapter Anthropic | Logic don gian, ro | Embed khong support; error handling toi gian | Tot |
+| `src/models/ollama.js` | Adapter local model | Co retry cho partial `<think>` | Vision request dung schema OpenAI-like, can test lai voi Ollama thuc te | Dung duoc |
+| `src/models/openrouter.js` | Adapter OpenRouter | Don gian, de hieu | Khong co embed, retry context-length chua that su hoan thien | Dung duoc |
+
+Nhan xet tong:
+
+- Tang model dang song tot neu ban chi dung `openai`, `anthropic`, `google`, `ollama`, `openrouter`.
+- Neu dung profile `grok`, `mistral`, `qwen`, `vllm`, `azure`, `mercury`, `groq` theo README/profile co san thi kha nang cao se loi.
+
+## 5.4 `src/agent` core
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/agent/agent.js` | Runtime trung tam cua moi bot | Ghep lich su, prompter, task, modes, server proxy, translation, vision, memory | File rat lon; `prev_health` khong khai bao; NPC tao ra nhung khong init; nhieu side effect event-based | Huyet mach cua he thong, nhung dang qua tai |
+| `src/agent/action_manager.js` | Quan ly action, interrupt, timeout, resume | Co y tuong dung cho action arbitration | Loi runtime nghiem trong o duong thanh cong; return type khong on dinh | Can sua truoc tien |
+| `src/agent/coder.js` | Sinh/chay code cho `!newAction` | Co lint, co sandbox, co retry | `makeCompartment` goi sai; method learned action khong co; load template async trong constructor co race nho | Gia tri thiet ke cao, implementation hien tai dang vo |
+| `src/agent/connection_handler.js` | Parse kick/disconnect reason | Co bang mapping co nghia | Van la heuristic string-based | Tot |
+| `src/agent/conversation.js` | Bot-to-bot conversation manager | Co active convo, queue, timeout/backoff | Nhieu floating promise; chi support 1 active conversation thuc su mot luc | Dung duoc cho workflow co dieu phoi don gian |
+| `src/agent/history.js` | Chat history + memory summarization | Co pinned message, memory budget, re-summarize | File I/O sync nhieu; `async` thua o vai ham | Kha tot |
+| `src/agent/memory_bank.js` | Named place + spatial memory | Co persist, query, limit culling | Tron named place va block memory chung mot object; uu tien cull cung | Huu ich, thuc dung |
+| `src/agent/mindserver_proxy.js` | Client socket cua agent toi server | Co lock API, settings fetch, state callback | Local lock fallback co the tao ao tuong mutual exclusion khi server mat | Tot |
+| `src/agent/modes.js` | Reflex/mode thoi gian thuc | Khong gian mode kha phong phu, uu tien safety truoc | Nhieu floating promise; `say` async thua; execution contract voi `ActionManager` dang mong | Co gia tri gameplay ro |
+| `src/agent/self_prompter.js` | Goal loop tu prompt lien tuc | Co backoff va anti-spin | Quan ly state bang flag hoi mong manh | Tot cho autonomous loop |
+| `src/agent/speak.js` | TTS local/remote | Ho tro system/OpenAI/Gemini | Queue/process co nhieu floating promise; phu thuoc `ffplay`; lint noise do globals | Tien ich phu, khong phai loi cot loi |
+| `src/agent/settings.js` | Mutable settings singleton cho child process | Don gian, phu hop chia se settings | Global mutable state | Chap nhan duoc |
+
+## 5.5 `src/agent/commands`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/agent/commands/index.js` | Parse/validate/dispatch command | Parser kha cong phu, support syntax ngoac va space-form | Co mot so semicolon/lint noise; van cho lenh docs stale xuat hien neu command ton tai nhung backend vo | Mot module tot va gia tri cao |
+| `src/agent/commands/actions.js` | Danh sach command gay tac dong world | Bao phu kha nhieu gameplay action | Phu thuoc `ActionManager`; `!newAction` bi anh huong boi coder bug | Core capability layer |
+| `src/agent/commands/queries.js` | Danh sach command query/debug/wiki/blueprint | `!stats`, `!inventory`, `!entities`, `!getCraftingPlan` kha huu ich | Reflex command treo vao subsystem khong co; `!searchWiki` fetch truc tiep web, khong cache theo key phuc tap | Huu ich nhung can cat command chet |
+
+## 5.6 `src/agent/library`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/agent/library/full_state.js` | Snapshot state day du cho UI | Defensive, fallback tot | Unit test cho file nay co gia tri hon cac test khac | Tot |
+| `src/agent/library/index.js` | Gom docs tu `skills` va `world` | Don gian | Phu thuoc docstring trong source | Tot |
+| `src/agent/library/lockdown.js` | SES lockdown + compartment factory | Huong tiep can an toan dung | Signature `makeCompartment(bot, endowments)` dang bi caller goi sai; lint globals sai | Kien truc tot, integration dang hong |
+| `src/agent/library/skill_library.js` | Embed/score docs cho code prompt | Y tuong tot cho retrieval | `getAllSkillDocs` async thua; phu thuoc embed model co shape dung | Tot |
+| `src/agent/library/world.js` | Helper doc world/query/context/action persistence | Nhieu utility de bot suy nghi theo state | Cong bo learned-action API ma khong co backend; mot so cache/query co TODO | Huu ich nhung contract chua dong bo |
+| `src/agent/library/skills.js` | Thuc thi hanh dong Minecraft thap tang | Bao phu rat rong: craft, move, fight, chest, villager, build, tool | File qua lon (~1980 lines), nhieu side effect, semicolon/floating promise, kho test don vi | Day la kho gameplay chinh, can tach module ve sau |
+
+## 5.7 `src/agent/tasks`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/agent/tasks/tasks.js` | Task wrapper chung cho cooking/techtree/construction | Gom validator, init inventory, teleport, timeout | Nhieu bug thuc te voi `available_agents`, `agent_id`, `human_count`; file doi tuong qua nhieu viec | Can uu tien sua som |
+| `src/agent/tasks/cooking_tasks.js` | Dung cheat command de setup world cooking benchmark | Setup map/crop/animal kha day du | Phu thuoc command cheat, file dai, retry co ban | Huu ich cho benchmark |
+| `src/agent/tasks/construction_tasks.js` | Blueprint, validator, procedural generation, world<->blueprint | Chuc nang nghien cuu rat phong phu | File rat lon, co mot so bien sai (`bot`), trach nhiem qua rong, lint issue nhieu | Gia tri nghien cuu cao, kho bao tri |
+
+## 5.8 `src/agent/npc`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/agent/npc/controller.js` | NPC routine/build/item goal | Co thiet ke theo muc tieu kha dep | Chua duoc init; goi `promptGoalSetting` khong ton tai; nhieu branch co the la dead code | Dang dang do |
+| `src/agent/npc/item_goal.js` | Planning de lay item theo recipe/source | Y tuong tree search decompose muc tieu hay | Dung bien `res` chua khai bao trong nhanh hunt; phu thuoc skill library lon | Co huong dung, can sua bug |
+| `src/agent/npc/build_goal.js` | Dat block theo construction goal | Don gian, de hieu | Phu thuoc world/skill layer va inventory map | On |
+| `src/agent/npc/utils.js` | Utility map generic block/item | Giai quyet matching wood/bed | Don gian | On |
+| `src/agent/npc/data.js` | Schema object cho NPC state | Gon | Basic | On |
+| `src/agent/npc/construction/*.json` | Preset nha/co truc NPC | Tai san dung cho NPC build | Asset-only, khong co schema validator rieng | Asset tot |
+
+## 5.9 `src/agent/vision`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/agent/vision/browser_viewer.js` | Prismarine viewer trong browser | Rat gon, de dung | Chi la wrapper nho | On |
+| `src/agent/vision/camera.js` | Render screenshot server-side | Ky thuat kha hay, dung `node-canvas-webgl` + viewer | Phu thuoc native deps nang | Huu ich neu can vision |
+| `src/agent/vision/vision_interpreter.js` | Goi model vision tu screenshot | Ket hop camera + prompt history | Chi hoat dong khi provider vision ho tro; phu thuoc IO file screenshot | On voi caveat |
+
+## 5.10 `src/utils`
+
+| File | Vai tro thuc te | Diem tot | Van de / canh bao | Danh gia |
+|---|---|---|---|---|
+| `src/utils/examples.js` | Example retrieval theo embedding/overlap | Co race protection khi load | Khong co cache eviction neu example bo lon thay doi lien tuc | Tot |
+| `src/utils/keys.js` | Nap API key + rate limit lookup | Co validation va sanitize thong bao loi | Global mutable state, rate limit kha so cap | Tot |
+| `src/utils/math.js` | `cosineSimilarity` | Defensive tot | Nho | Tot |
+| `src/utils/mcdata.js` | Adapter data Minecraft + planning craft | Rat nhieu helper gia tri cao, co anti-recursion | File lon, comment/encoding lech, semicolon noise | Gia tri cao |
+| `src/utils/profile_validator.js` | Path sanitize + JSON parse + profile merge | Mot trong cac file chat va an toan nhat repo | Validation profile moi o muc basic, chua validate model support | Tot |
+| `src/utils/text.js` | Format turn, overlap score, strip think tag | Nho, ro, co gia tri cao | Chuoi comment encoding loi nhe | Tot |
+| `src/utils/translator.js` | Google translate wrapper | Defensive, timeout, sanitize input | Regex control-char bi lint danh dau; phu thuoc package ngoai | Dung duoc |
+
+## 5.11 `src/mindcraft-py`
+
+| File | Vai tro thuc te | Danh gia nhanh |
+|---|---|---|
+| `mindcraft.py` | Python bridge/script sidecar | Module phu, khong phai runtime chinh |
+| `init-mindcraft.js` | Khoi tao tu phia JS cho Python bridge | Nho, utility |
+| `example.py` | Vi du su dung | Tai lieu/phu tro |
+
+## 6. Phan tich tasks, datasets, profiles, patches, tests, docs
+
+## 6.1 Thu muc `tasks/`
+
+### Script runtime/evaluation
+
+| File / nhom | Vai tro thuc te | Nhan xet |
+|---|---|---|
+| `tasks/run_task_file.py` | Chay lan luot task trong mot file JSON | Script gon, de dung |
+| `tasks/human_ai_tasks.py` | Bien the run task cho human+AI | Giong `run_task_file.py`, utility |
+| `tasks/evaluation_script.py` | Dieu phoi benchmark lon, tmux, server, S3, profile generation | Day la script nghien cuu lon, rat nhieu trach nhiem, coupling cao vao tmux/Linux/server data |
+| `tasks/human_evaluation.js` | Ho tro human eval | Khong phai runtime core |
+| `tasks/multi_data_collection_script.py` | Gom ket qua experiment | Phuc vu benchmark |
+| `tasks/analyse_results.py`, `analyze_crafting_tasks.py`, `analyze_cooking_tasks.py`, `analyze_construction_tasks.py`, `new_analyze_construction_tasks.py` | Tong hop/phan tich ket qua benchmark | Scripts nghien cuu hop ly, nhung khong co package/test rieng |
+| `tasks/experiment_script.sh` | Shell helper benchmark | Script phu |
+
+### Task generation / blueprint
+
+| File / nhom | Vai tro thuc te | Nhan xet |
+|---|---|---|
+| `tasks/construction_tasks/generate_multiagent_construction_tasks.js` | Sinh bo construction task | Su dung procedural generation tu source |
+| `tasks/construction_tasks/get_blueprint.js` | Quet world thanh blueprint/task | Tool thu cong hieu qua cho dataset |
+| `tasks/construction_tasks/analyze_multiagent_construction_tasks.js` | Phan tich construction task | Nghien cuu |
+| `tasks/construction_tasks/blueprint_visualizer.py` | Visualize blueprint | Utility |
+| `tasks/construction_tasks/filter_easy_tasks.py`, `filter_training_tasks.py` | Loc task dataset | Utility |
+| `tasks/cooking_tasks/hells_kitchen_tasks.py`, `make_collaboration_required_cooking_task.py` | Sinh cooking benchmark | Gia tri cao cho benchmark |
+
+### JSON dataset
+
+Nhom JSON trong `tasks/` nhin chung duoc to chuc hop ly theo family:
+
+- `tasks/basic/`
+- `tasks/single_agent/`
+- `tasks/crafting_tasks/`
+- `tasks/cooking_tasks/`
+- `tasks/construction_tasks/custom/`
+- `tasks/*/human_ai/`
+
+Nhan xet:
+
+- Naming kha nhat quan.
+- Khong thay schema validator chinh thuc cho tung file task.
+- Nhieu file la benchmark data thuan, khong nen sua tay neu chua co script generate tuong ung.
+
+## 6.2 Thu muc `profiles/`
+
+| Profile | Muc dich | Trang thai thuc te |
+|---|---|---|
+| `andy-4.json`, `andy-4-reasoning.json` | Local Ollama profile | Hoat dong neu co model local |
+| `gpt.json` | OpenAI profile | Hoat dong |
+| `claude.json`, `claude_thinker.json` | Anthropic profile | Hoat dong |
+| `gemini.json` | Google profile | Hoat dong |
+| `deepseek.json` | DeepSeek profile | Chay duoc qua OpenAI-compatible heuristic, nhung naming khong con dung voi adapter rieng |
+| `freeguy.json`, `llama.json` | Groq llama profile | Dang bi misclassify thanh `ollama` |
+| `grok.json` | xAI profile | Dang vo vi khong co adapter/xai mapping |
+| `mistral.json` | Mistral profile | Dang vo |
+| `mercury.json` | Mercury profile | Dang vo |
+| `qwen.json` | Qwen profile | Dang vo |
+| `vllm.json` | vLLM local profile | Dang vo |
+| `azure.json` | Azure OpenAI profile | Dang vo |
+| `quangdz.json` | Custom local profile | Hien resolve duoc chi vi model string co chua `claude`, khong phai vi prefix `quangdz` duoc support |
+| `profiles/defaults/*.json` | Base prompt/mode profile | Nap duoc, dung tot |
+| `profiles/tasks/*.json` | Profile template cho benchmark | Parse duoc |
+| `profiles/defaults/seed_skills/*.js` | Script "seed skill" phu tro | Asset logic them, khong thay duoc tich hop manh vao runtime hien tai |
+
+Nhan xet tong:
+
+- Profile inventory phong phu hon kha nang adapter hien tai.
+- Validation profile hien tai chi kiem tra "shape", chua kiem tra "profile nay co chay duoc that khong".
+
+## 6.3 Thu muc `patches/`
+
+| Patch | Muc dich thuc te |
+|---|---|
+| `minecraft-data+3.97.0.patch` | Sua protocol checksum type |
+| `mineflayer+4.33.0.patch` | Dieu chinh logic tool/material khi dig |
+| `mineflayer-pathfinder+2.4.5.patch` | Them xu ly lava cho movement |
+| `mineflayer-pvp+1.3.2.patch` | Sua event `physicsTick` |
+| `prismarine-viewer+1.33.0.patch` | Bo qua unknown entity thay vi throw |
+| `protodef+1.19.0.patch` | Tat spam log partial packet |
+
+Nhan xet:
+
+- Patch-package dang duoc dung dung muc dich.
+- Repo phu thuoc vao patch de on dinh runtime, nen can giu dong bo version dependency.
+
+## 6.4 Thu muc `tests/`
+
+| File / nhom | Gia tri thuc te | Nhan xet |
+|---|---|---|
+| `tests/tier2/world.test.js` | Test utility world | Co y nghia, nhung runner direct no-op tren Windows |
+| `tests/tier2/mcdata.test.js` | Test craft recursion/logic | Co y nghia, nhung cung no-op tren Windows |
+| `tests/tier2/tasks.test.js` | Test task race/logic | Nhieu case dang kiem tra logic gia lap, khong import thang module that |
+| `tests/tier4/models.test.js` | Test model selection / text utils | Mo ta tot nhung no-op tren Windows neu chay direct |
+| `tests/tier4/providers.test.js` | Test provider integration | Out-of-sync nang voi repo hien tai vi ky vong nhieu file adapter khong con ton tai |
+| `tests/tier5/math.test.js`, `text.test.js`, `keys.test.js`, `translator.test.js`, `examples.test.js`, `full_state.test.js` | Test utility | Co gia tri, nhung can runner dong bo va mot so test phu thuoc dep/network |
+| `tests/tier8/config_validation.test.js` | Test validation/security profile | Day la bo test dang tin cay nhat hien tai, thuc su chay va pass |
+
+Tong ket:
+
+- Test suite co tiem nang.
+- Nhung do runner lech nen muc bao ve hien tai thap hon ve be ngoai.
+
+## 6.5 Thu muc docs / services / misc
+
+| File / nhom | Vai tro |
+|---|---|
+| `services/viaproxy/README.md` | Huong dan proxy phien ban Minecraft |
+| `bots/execTemplate.js`, `bots/lintTemplate.js` | Template cho generated code; rat quan trong doi voi `Coder` |
+| `requirements.txt` | Python deps benchmark |
+| `LICENSE` | Giay phep |
+
+## 7. Kien truc logic hien tai
+
+### 7.1 Luong khoi dong
+
+`main.js` -> `Mindcraft.init()` -> `Mindcraft.createAgent()` -> `AgentProcess.start()` -> `src/process/init_agent.js` -> `serverProxy.connect()` -> `new Agent().start()`
+
+Nhan xet:
+
+- Kien truc subprocess ro.
+- MindServer la diem giao tiep duy nhat giua UI va child agent.
+- Kieu thiet ke nay hop ly cho multi-agent benchmark.
+
+### 7.2 Luong prompt
+
+`Agent.handleMessage()` -> `History` -> `Prompter.promptConvo()` -> model adapter -> neu co command thi `executeCommand()` -> `ActionManager`
+
+Nhan xet:
+
+- Day la luong logic hop ly va de mo rong.
+- Van de hien tai nam o implementation/contract hon la o kien truc tong.
+
+### 7.3 Luong task
+
+`Task.initBotTask()` -> clear/give/teleport/init benchmark -> `setAgentGoal()` -> bot tu self-prompt / command / coordinate
+
+Nhan xet:
+
+- Phu hop benchmark research.
+- Rui ro cao do `Task` dang xu ly qua nhieu viec va co nhieu bug data-shape.
+
+## 8. Danh gia theo tieu chi
+
+| Tieu chi | Danh gia | Nhan xet |
+|---|---|---|
+| Kien truc tong the | Kha | Chia lop ro, de mo rong |
+| Do on dinh runtime | Trung binh/yeu | Co bug cot loi o action va coding |
+| Do tin cay cua test | Yeu | Co test pass that, nhung nhieu test khong chay that |
+| Tinh dong bo doc-code | Yeu | README/BOT_GUIDE/profile/test stale |
+| Bao mat | Trung binh | Co sanitize profile path, SES; nhung local settings dang bat insecure coding/reflex |
+| Kha nang maintain | Trung binh/yeu | Nhieu file qua lon, lint khong con co y nghia |
+| Gia tri research/benchmark | Tot | Dataset, task, benchmark orchestration rat day du |
+
+## 9. Uu tien sua de xai thuc te
+
+### Uu tien 1
+
+1. Sua `ActionManager._executeAction()` de bo bien undefined va chot mot return contract on dinh.
+2. Sua `Coder` + `makeCompartment()` wiring cho `!newAction`.
+3. Sua `Task.available_agents` de chi luu danh sach ten hoac tach ro object/name.
+4. Goi `npc.init()` neu subsystem nay van duoc muon giu, neu khong thi loai bo code chet va command/doc lien quan.
+5. Bo hoac sua cac command reflex/learned-action dang tro vao implementation khong ton tai.
+
+### Uu tien 2
+
+6. Don dep he provider:
+   - Hoac khoi phuc adapter da mat.
+   - Hoac cat README/profile/test de chi con provider thuc su support.
+7. Sua test runner Windows va chuyen sang `node:test` thong nhat.
+8. Sua `eslint.config.js` cho Node ESM hien tai.
+
+### Uu tien 3
+
+9. Tach nho `skills.js`, `construction_tasks.js`, `agent.js`, `prompter.js`.
+10. Them schema validator cho task JSON.
+11. Dong bo `settings_spec.json` voi `settings.js`.
+
+## 10. Ket luan thuc dung
+
+Neu muc tieu la:
+
+- Hoc cau truc agent Minecraft + multi-agent benchmark:
+  - Repo nay rat co gia tri.
+- Chay bot voi `openai`/`claude`/`gemini`/`ollama` trong local sandbox:
+  - Co the, nhung can sua nhanh nhom bug `ActionManager` va `Coder`.
+- Tin vao docs/profile/test hien tai de mo rong nhanh:
+  - Khong nen. Can doi code source lam source of truth.
+
+Trang thai thuc te hien tai:
+
+- "Kien truc dep, implementation dang co nhieu contract bi dut."
+- Day khong phai repo vo toan bo; no la repo co nen tang tot, nhung dang can mot dot "alignment + stabilization" rat ro rang.
+
