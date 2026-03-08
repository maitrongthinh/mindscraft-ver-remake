# MINDCRAFT — QUY TẮC LÀM VIỆC CHO AI AGENT

> Bất kỳ AI agent nào làm việc trên project này phải đọc file này trước.
> File này áp dụng lâu dài, không phụ thuộc vào phiên bản cụ thể nào.

---

## PHẦN 0: THÁI ĐỘ LÀM VIỆC

### Trung thực, không nể nang

- **Có sao nói vậy.** Nếu code cũ có vấn đề, nói rõ vấn đề là gì. Không nói "code khá tốt" khi thực tế nó có bug.
- **Không chiều theo ý user nếu ý đó sai.** Nếu user yêu cầu làm điều sẽ phá vỡ bot, phải giải thích rõ tại sao không nên và đề xuất cách tốt hơn. Không im lặng làm theo rồi để hỏng.
- **Không phóng đại.** Không nói "hệ thống AI cực kỳ tiên tiến" khi thực tế nó chỉ là vòng lặp gọi LLM rồi parse command. Không gọi 1 object đơn giản là "advanced memory architecture". Mô tả đúng mức độ thực tế.
- **Tư vấn chủ động.** Nếu thấy cách làm tốt hơn, nói ra. Nếu thấy yêu cầu mơ hồ, hỏi lại. Nếu thấy scope quá lớn, đề nghị chia nhỏ.
- **Nhận sai khi sai.** Nếu viết code lỗi hoặc hiểu nhầm, thừa nhận thẳng thay vì sửa lặng lẽ.

### Đặt tên thực tế

- **Không đặt tên hầm hố.** `processData` thay vì `HyperIntelligentDataProcessor`. `moveToSafety` thay vì `AdvancedSurvivalEvasionSystem`. `memory` thay vì `NeuralPersistentCortex`.
- **Tên phải mô tả đúng chức năng.** Đọc tên phải biết function làm gì mà không cần đọc code bên trong.
- **Theo convention đã có trong project.** Project dùng `camelCase` cho functions, `PascalCase` cho classes. Skill names là `verb + noun` (ví dụ: `collectBlock`, `craftRecipe`, `attackNearest`). Giữ đúng style này.

---

## PHẦN 1: HIỂU CẤU TRÚC TRƯỚC KHI LÀM

### Bắt buộc trước mỗi lần làm việc

1. **Đọc cấu trúc thư mục** — dùng `list_dir` hoặc tương đương để nắm layout hiện tại
2. **Đọc toàn bộ file cần sửa** — không đọc lướt, không đoán nội dung
3. **Xác định file nào import từ file này** — sửa 1 file có thể phá vỡ 10 file khác
4. **Hiểu luồng chạy** — trước khi sửa, trace code từ đầu đến cuối để hiểu flow

### Nguyên tắc cấu trúc

- **Không di chuyển, đổi tên, xóa file** trừ khi user yêu cầu rõ ràng VÀ đã hiểu hậu quả
- **Không merge/split file** — mỗi file hiện tại có lý do tồn tại, đừng gộp "cho gọn"
- **File mới phải đặt đúng folder.** Nếu không chắc đặt đâu, hỏi user
- **`patches/` là vùng cấm** — đây là monkey patches cho dependencies, không sửa
- **`profiles/defaults/_default.json`** chứa toàn bộ prompt template — sửa sai = bot ngu đi. Phải hiểu rõ prompt system trước khi đụng
- **`bots/` là thư mục runtime** — dữ liệu tạo khi bot chạy, không commit

### Khi project thay đổi cấu trúc

File rules này không khóa cứng vào bất kỳ danh sách file cụ thể nào. Nếu project đã thay đổi (thêm file, đổi tên, refactor), agent phải:
1. Khảo sát lại cấu trúc thực tế
2. Tuân theo patterns và conventions mà codebase hiện tại đang dùng
3. Không áp đặt cấu trúc cũ nếu nó đã được thay đổi có chủ đích

---

## PHẦN 2: KHÔNG FAKE CODE

Đây là luật quan trọng nhất. Lý do: AI agent có xu hướng viết code "trông đúng" nhưng không hoạt động. Với Minecraft bot, code fake = bot đứng im hoặc crash.

### Cấm tuyệt đối

| Loại fake | Ví dụ | Tại sao cấm |
|-----------|-------|-------------|
| Hàm rỗng | `function doThing() {}` | Gọi sẽ không làm gì |
| TODO không implement | `// TODO: add mining logic` | Nợ kỹ thuật vô hạn |
| Return giả | `return { success: true }` mà không làm gì | Bot nghĩ thành công, thực tế không |
| Console.log thay logic | `console.log("crafting...")` | User không thấy, bot không craft |
| Comment thay code | `// here we check inventory` | Không check thật |
| Catch rỗng | `catch(err) {}` | Lỗi bị nuốt, debug không được |
| Stub "sẽ làm sau" | `async function mine() { /* later */ }` | "Sau" không bao giờ đến |

### Bắt buộc

- Mỗi function phải có logic thực sự chạy được
- Mỗi `try` phải có `catch` xử lý lỗi thật: log ra, return giá trị có nghĩa
- Mỗi `async` function phải có `await` đúng chỗ
- Mỗi `return` phải trả data thực từ nguồn thực (bot API, world query, inventory)

---

## PHẦN 3: KHÔNG ĐƠN GIẢN HÓA

AI agent hay "tối ưu" bằng cách bỏ bớt logic. Với Minecraft bot, mỗi check đều có lý do — bỏ 1 check = bot chết/kẹt/crash trong edge case.

### Quy tắc

- Nếu code cũ check 5 điều kiện → code mới phải check ≥ 5 điều kiện
- Nếu code cũ có timeout → code mới phải có timeout
- Nếu code cũ có `bot.interrupt_code` check → code mới phải có
- Nếu code cũ log kết quả → code mới phải log kết quả
- Không xóa error handling "cho gọn"
- Không thay state machine bằng if/else đơn giản

### Khi nào ĐƯỢC đơn giản hóa

Chỉ khi:
1. User yêu cầu cụ thể
2. Agent giải thích rõ hậu quả (mất edge case nào)
3. User vẫn đồng ý sau khi nghe giải thích

---

## PHẦN 4: VIẾT SKILL ĐÚNG CÁCH — "KIỂM TRA TRƯỚC, LÀM SAU"

Bot Minecraft hoạt động trong thế giới có vật lý, inventory hữu hạn, mob nguy hiểm. Code phải defensive.

### Pattern bắt buộc cho mọi skill

```javascript
export async function tenSkill(bot, param1, param2) {
    /**
     * Mô tả ngắn, đúng chức năng thực tế.
     * @param {MinecraftBot} bot
     * @param {type} param1 - mô tả
     * @returns {Promise<boolean>} true nếu thành công
     * @example await skills.tenSkill(bot, "value");
     **/

    // 1. Validate input
    if (!param1) {
        log(bot, `Missing param1.`);
        return false;
    }

    // 2. Check điều kiện tiên quyết (có item? có tool? đủ gần?)
    const hasRequiredItem = bot.inventory.items().find(i => i.name === param1);
    if (!hasRequiredItem) {
        log(bot, `Don't have ${param1}.`);
        return false;
    }

    // 3. Thực hiện với error handling
    try {
        await actualBotAction(bot, param1);
        log(bot, `Successfully did ${param1}.`);
        return true;
    } catch (err) {
        log(bot, `Failed: ${err.message}`);
        return false;
    }
}
```

### Checklist mỗi skill phải qua

1. ✅ Validate tất cả parameters
2. ✅ Check bot có item/tool cần thiết
3. ✅ Check khoảng cách (quá xa → di chuyển trước)
4. ✅ Check target tồn tại (block/entity)
5. ✅ `bot.interrupt_code` check trong mọi loop
6. ✅ Try/catch bọc mọi bot API call
7. ✅ `log(bot, ...)` cho cả success và failure
8. ✅ Return boolean rõ ràng
9. ✅ Không block quá 30s mà không check interrupt
10. ✅ Cleanup resources khi xong (close window, stop pathfinder)

---

## PHẦN 5: QUY TRÌNH SỬA CODE

### Trước khi sửa bất kỳ file nào

```
1. ĐỌC toàn bộ file
2. HIỂU mọi function làm gì
3. XÁC ĐỊNH file nào import/depend vào file này
4. XÁC ĐỊNH chính xác dòng cần sửa và lý do
5. KIỂM TRA thay đổi có phá import chain không
6. MỚI SỬA
```

### Mức nguy hiểm

Không phải file nào cũng nguy hiểm như nhau. Đây là hướng dẫn chung — agent phải tự đánh giá dựa trên thực tế:

- **Rất nguy hiểm**: File controller chính (agent orchestrator), file parse/execute commands, file quản lý modes/behaviors, file prompt system. Sửa sai = bot không hoạt động. → Chỉ sửa dòng cụ thể, không refactor.
- **Nguy hiểm**: File skills, world queries, conversation manager, action executor. Nhiều file khác phụ thuộc vào. → Thêm code mới OK, sửa code cũ cẩn thận.
- **Ít nguy hiểm**: File đơn lẻ ít dependency (memory, speak, model adapters, connection handler). → Sửa tự do hơn nhưng vẫn theo quy tắc chất lượng.

### Không được làm khi sửa

- Không xóa code "trông thừa" — có thể nó xử lý edge case bạn chưa thấy
- Không "refactor" nếu user không yêu cầu — refactor luôn có rủi ro
- Không đổi function signature (thêm/bớt params, đổi return type) mà không update mọi nơi gọi nó
- Không đổi export/import pattern của file

---

## PHẦN 6: CODE BOT TỰ VIẾT (qua coder.js / !newAction)

Khi bot dùng `!newAction`, LLM sẽ viết code chạy trong sandbox. Code này có giới hạn.

### Được dùng

```
skills.*   — Mọi function exported từ skills.js
world.*    — Mọi function exported từ world.js  
Vec3()     — Constructor tọa độ
log()      — Ghi output
```

### Không được dùng

```
process, require, import, fs, net, http, child_process
eval, Function constructor
setTimeout/setInterval không await
Vòng lặp vô hạn không có interrupt check
```

### Code bot viết phải defensive

```javascript
// ĐÚng: Check từng bước, không giả sử bước trước OK
async function main(bot) {
    const success = await skills.collectBlock(bot, 'oak_log', 3);
    if (!success) {
        log(bot, "Couldn't collect wood, stopping.");
        return;
    }
    await skills.craftRecipe(bot, 'oak_planks', 1);
}

// SAI: Chain calls không check kết quả
async function main(bot) {
    await skills.collectBlock(bot, 'oak_log', 3);
    await skills.craftRecipe(bot, 'oak_planks', 1);  // fails if no wood
    await skills.craftRecipe(bot, 'stick', 1);        // fails if no planks
}
```

---

## PHẦN 7: THÊM TÍNH NĂNG MỚI

### Quy trình

1. Xác định feature thuộc layer nào (skill? command? mode? model adapter?)
2. Đọc 3+ functions tương tự đã có trong file đó
3. Copy pattern chính xác, thay logic bên trong
4. Thêm vào cuối file, không chen giữa code cũ
5. Tên function/command phải mô tả đúng chức năng — không hầm hố

### Thêm command (vào actions.js hoặc queries.js)

```javascript
{
    name: '!tenCommand',
    description: 'Mô tả ngắn gọn, đúng thực tế.',
    params: {
        'param_name': { type: 'string', description: 'Mô tả.' }
    },
    perform: runAsAction(async (agent, param_name) => {
        await skills.tenSkill(agent.bot, param_name);
    })
}
```

### Thêm mode (vào modes_list trong modes.js)

```javascript
{
    name: 'ten_mode',          // tên đơn giản, mô tả hành vi
    description: 'Mô tả ngắn.',
    interrupts: [],            // ['all'] nếu ưu tiên cao
    on: false,                 // MẶC ĐỊNH OFF cho mode mới
    active: false,
    update: async function (agent) {
        // Logic chạy mỗi tick (~300ms)
        // KHÔNG block quá 100ms
    }
}
```

### Thêm model adapter (file mới trong src/models/)

```javascript
export class TenModel {
    static prefix = 'ten_prefix';  // bắt buộc, dùng để auto-discover

    constructor(model_name, url, params) { /* init */ }

    async sendRequest(turns, systemMessage, stop_seq='***') {
        // phải return string
        // phải handle errors
    }

    async embed(text) {
        // return array, optional
    }
}
```

---

## PHẦN 8: CHỐNG AGENT LÀM SAI

### Trước khi submit code, agent phải tự kiểm tra

- [ ] Tôi đã đọc toàn bộ file trước khi sửa?
- [ ] Code mới thực sự chạy được? (không phải placeholder)
- [ ] Tôi có xóa hoặc đơn giản hóa logic nào không?
- [ ] Error handling đầy đủ?
- [ ] Import chain có bị phá không?
- [ ] Tôi có thêm code không ai yêu cầu không?
- [ ] Bot có thể crash từ code tôi viết không?
- [ ] Tên function/variable có đúng convention không?
- [ ] Tôi có giải thích cho user những gì tôi thay đổi không?

### Dấu hiệu code cần reject

| Dấu hiệu | Ví dụ |
|-----------|-------|
| Hàm rỗng | `function x() {}` |
| Return giả | `return true` mà không làm gì |
| TODO không code | `// TODO: implement` |
| Xóa error handling | Bỏ try/catch |
| Đổi function signature | Thêm/bớt params mà không update caller |
| Tên quá hào nhoáng | `UltraDefenseMatrix` thay vì `defendSelf` |
| Console.log thay logic | `console.log("done")` thay vì thực sự làm |

### Khi không chắc chắn

1. **Hỏi user** thay vì đoán
2. Nếu không hỏi được → **không sửa**, ghi lại cần làm gì
3. Nếu scope quá lớn → **đề nghị chia nhỏ**
4. Nếu không hiểu code cũ → **đọc lại**, không viết lại "cho đơn giản"
5. Nếu có 2 cách → **chọn cách ít thay đổi code cũ hơn**
6. Nếu user yêu cầu điều có hại → **giải thích tại sao có hại**, đề xuất thay thế

---

## PHẦN 9: BUGS ĐÃ BIẾT

Danh sách này có thể đã cũ. Agent nên tự verify trước khi fix.

- `agent.js` — Vị trí death log dùng nhầm `death_pos.x` cho tọa độ z (copy-paste)
- `skills.js` — `placeBlock` phần door/bed thiếu braces, logic chạy sai điều kiện
- `world.js` — `getNearestFreeSpace` dùng `!top.name == 'air'` (operator precedence sai)
- `coder.js` — `_stageCode` dùng biến `result` chưa khai báo (nên là `write_result`)

> Agent KHÔNG tự ý fix bugs trừ khi user yêu cầu. Fix bug cũng có thể tạo bug mới.

---

## PHẦN 10: TÓM TẮT

```
 1. Đọc trước khi sửa
 2. Không xóa code cũ nếu không hiểu rõ nó làm gì
 3. Không fake code — mỗi dòng phải hoạt động thật
 4. Kiểm tra đầu vào — validate mọi parameter
 5. Xử lý lỗi — try/catch + log + return có nghĩa
 6. Interrupt check — bot.interrupt_code trong mọi loop
 7. Giữ cấu trúc — file đúng folder, pattern đúng mẫu
 8. Không liều — check trước khi làm
 9. Không nổ — đặt tên thực tế, mô tả đúng mức độ
10. Trung thực — có sao nói vậy, tư vấn khi cần, phản đối khi sai
```

---
và hạn chế tạo thêm file 
*File này không khóa cứng vào phiên bản cụ thể nào của codebase. Khi project thay đổi, nguyên tắc vẫn áp dụng — agent tự khảo sát lại cấu trúc thực tế.*
