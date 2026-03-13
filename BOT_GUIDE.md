# 🤖 Mindcraft Bot – Hướng Dẫn Toàn Diện

> Tài liệu hướng dẫn sử dụng bot Mindcraft, bao gồm tất cả lệnh, chế độ, profile, cấu hình, và chiến lược để bot **tự sinh tồn & phá đảo game**.

---

## 📋 Mục Lục

1. [Cài đặt & Khởi chạy](#1-cài-đặt--khởi-chạy)
2. [Cấu hình Settings](#2-cấu-hình-settings)
3. [Profile – Bộ cá tính bot](#3-profile--bộ-cá-tính-bot)
4. [Toàn bộ Lệnh (Commands)](#4-toàn-bộ-lệnh-commands)
5. [Chế độ tự động (Modes)](#5-chế-độ-tự-động-modes)
6. [Hệ thống Reflex – Tự học phản xạ](#6-hệ-thống-reflex--tự-học-phản-xạ)
7. [Hệ thống Task Tree – Quản lý nhiệm vụ](#7-hệ-thống-task-tree--quản-lý-nhiệm-vụ)
8. [Hệ thống Confidence – Cảm xúc bot](#8-hệ-thống-confidence--cảm-xúc-bot)
9. [Memory Bank – Bộ nhớ không gian](#9-memory-bank--bộ-nhớ-không-gian)
10. [Auto-Reconnect – Tự kết nối lại](#10-auto-reconnect--tự-kết-nối-lại)
11. [🎮 Chiến Lược Phá Đảo Game](#11--chiến-lược-phá-đảo-game)

---

## 1. Cài đặt & Khởi chạy

### Yêu cầu
- **Node.js** v18+
- **Minecraft Server** (local hoặc Aternos)
- **API Key** cho mô hình AI (Groq, OpenAI, Gemini, v.v.)

### Khởi chạy nhanh
```bash
# Cài dependencies
npm install

# Chạy bot
node main.js
```

### File cấu hình chính
| File | Mô tả |
|------|--------|
| `settings.js` | Cấu hình toàn cục (server, port, profile, modes) |
| `profiles/*.json` | Profile cho từng mô hình AI |
| `keys.json` | API keys cho các dịch vụ AI |

---

## 2. Cấu hình Settings

File: `settings.js`

### Kết nối Server
| Setting | Mặc định | Mô tả |
|---------|---------|-------|
| `minecraft_version` | `"auto"` | Phiên bản MC, hoặc cụ thể `"1.21.6"` |
| `host` | `"127.0.0.1"` | IP server Minecraft |
| `port` | `5000` | Port server (set -1 để auto scan) |
| `auth` | `"offline"` | `"offline"` hoặc `"microsoft"` |

### Profile & Ban đầu
| Setting | Mặc định | Mô tả |
|---------|---------|-------|
| `base_profile` | `"survival"` | Profile gốc: `survival`, `assistant`, `creative`, `god_mode` |
| `profiles` | `["./profiles/freeguy.json"]` | Danh sách profile bot (mỗi profile = 1 bot) |
| `load_memory` | `false` | Tải bộ nhớ từ session trước |
| `init_message` | `"Respond with hello world..."` | Tin nhắn gửi khi bot spawn |

### AI & Bảo mật
| Setting | Mặc định | Mô tả |
|---------|---------|-------|
| `allow_insecure_coding` | `false` | Cho phép `!newAction` (bot viết code) |
| `allow_vision` | `false` | Cho phép bot "nhìn" qua screenshot |
| `code_timeout_mins` | `-1` | Giới hạn thời gian chạy code (-1 = không giới hạn) |
| `max_messages` | `15` | Số tin nhắn tối đa trong context |
| `max_commands` | `-1` | Số lệnh liên tiếp tối đa (-1 = không giới hạn) |

### Hiển thị
| Setting | Mặc định | Mô tả |
|---------|---------|-------|
| `narrate_behavior` | `true` | Bot chat hành động tự động ("Picking up item!") |
| `chat_ingame` | `true` | Hiển thị phản hồi trong chat MC |
| `render_bot_view` | `false` | Hiển thị góc nhìn bot tại `localhost:3000` |

---

## 3. Profile – Bộ cá tính bot

Mỗi file JSON trong `profiles/` định nghĩa 1 bot với AI model riêng.

### Cấu trúc Profile
```json
{
    "name": "TênBot",
    "model": "groq/llama-3.3-70b-versatile",
    "max_tokens": 8000,
    "cooldown": 5000,
    "modes": {
        "self_defense": true,
        "hunting": true,
        "cowardice": false
    }
}
```

### Base Profiles có sẵn
| Profile | Mô tả | Modes đặc biệt |
|---------|--------|----------------|
| `survival` | Sinh tồn chuẩn | `self_defense: ON`, `cowardice: OFF`, `cheat: OFF` |
| `assistant` | Hỗ trợ người chơi | Ít tự chủ hơn |
| `creative` | Sáng tạo, xây dựng | Tập trung build |
| `god_mode` | Bất tử, toàn năng | `cheat: ON` |

### Profiles AI có sẵn
| File | Model | Ghi chú |
|------|-------|---------|
| `freeguy.json` | Groq Llama 3.3 70B | **Đang dùng**, miễn phí |
| `gpt.json` | OpenAI GPT | Tốt nhất, tốn tiền |
| `claude.json` | Anthropic Claude | Chất lượng cao |
| `gemini.json` | Google Gemini | Miễn phí tier |
| `qwen.json` | Alibaba Qwen Plus | Miễn phí tier |
| `deepseek.json` | DeepSeek | Rẻ, thông minh |
| `llama.json` | Meta Llama | Local hoặc API |
| `grok.json` | xAI Grok | |
| `mistral.json` | Mistral AI | |

> **Mẹo**: Sử dụng nhiều profile = nhiều bot cùng lúc. Khi đó phải `/msg <tên_bot>` riêng từng con.

---

## 4. Toàn bộ Lệnh (Commands)

Gõ lệnh trong chat Minecraft bắt đầu bằng `!`. Cú pháp: `!lệnh(tham_số1, "tham_số_chuỗi")`.

### 🔧 Điều khiển Bot
| Lệnh | Mô tả |
|-------|--------|
| `!stop` | Dừng mọi hành động ngay lập tức |
| `!stfu` | Im lặng, dừng self-prompt nhưng vẫn làm việc |
| `!restart` | Khởi động lại bot |
| `!clearChat` | Xóa lịch sử chat |

### 🚶 Di chuyển
| Lệnh | Mô tả |
|-------|--------|
| `!goToPlayer("tên", khoảng_cách)` | Đi đến người chơi |
| `!followPlayer("tên", khoảng_cách)` | Đi theo người chơi liên tục |
| `!goToCoordinates(x, y, z, khoảng_cách)` | Đi đến tọa độ |
| `!searchForBlock("loại", phạm_vi)` | Tìm và đi đến block gần nhất |
| `!searchForEntity("loại", phạm_vi)` | Tìm và đi đến entity gần nhất |
| `!stay(giây)` | Đứng yên tại chỗ (mặc định vĩnh viễn, -1) |
| `!goToBed` | Đi ngủ giường gần nhất |
| `!digDown(khoảng_cách)` | Đào xuống |
| `!goToSurface` | Đi lên mặt đất |

### 📍 Ghi nhớ vị trí
| Lệnh | Mô tả |
|-------|--------|
| `!rememberHere("tên")` | Lưu vị trí hiện tại |
| `!goToRememberedPlace("tên")` | Đi đến vị trí đã lưu |

### 📦 Vật phẩm & Kho
| Lệnh | Mô tả |
|-------|--------|
| `!collectBlocks("loại", số_lượng)` | Thu thập block |
| `!craftRecipe("tên_item", số_lượng)` | Craft item |
| `!smeltItem("tên_item", số_lượng)` | Nung item |
| `!consume("tên_item")` | Ăn/uống item |
| `!equip("tên_item")` | Trang bị item |
| `!discard("tên_item", số_lượng)` | Vứt item |
| `!givePlayer("tên_người", "tên_item", số_lượng)` | Cho người chơi item |
| `!putInChest("tên_item", số_lượng)` | Cất vào chest gần nhất |
| `!takeFromChest("tên_item", số_lượng)` | Lấy từ chest gần nhất |
| `!viewChest` | Xem nội dung chest gần nhất |

### ⚔️ Chiến đấu
| Lệnh | Mô tả |
|-------|--------|
| `!attackPlayer("tên")` | Tấn công người chơi |
| `!useOn("công_cụ", "mục_tiêu")` | Sử dụng tool trên target |

### 🏗️ Xây dựng
| Lệnh | Mô tả |
|-------|--------|
| `!placeHere("tên_block")` | Đặt block tại vị trí hiện tại |

### 🧠 AI & Mục tiêu
| Lệnh | Mô tả |
|-------|--------|
| `!newAction("mô_tả")` | Bot tự viết code (cần `allow_insecure_coding`) |
| `!goal("mục_tiêu")` | Đặt mục tiêu self-prompt |
| `!endGoal` | Kết thúc mục tiêu |
| `!startLongTermGoal("nhiệm_vụ")` | Nhiệm vụ dài hạn (task tree) |
| `!longTermGoalStatus` | Xem tiến độ nhiệm vụ dài hạn |
| `!pauseLongTermGoal(true/false)` | Tạm dừng/tiếp tục nhiệm vụ |
| `!clearLongTermGoal` | Xóa nhiệm vụ dài hạn |

### 🔧 Chế độ
| Lệnh | Mô tả |
|-------|--------|
| `!setMode("tên_mode", true/false)` | Bật/tắt chế độ |

### 📡 Giao tiếp bot-to-bot
| Lệnh | Mô tả |
|-------|--------|
| `!sendMessage("tên_bot", "nội_dung")` | Gửi tin nhắn cho bot khác |
| `!endConversation("tên_bot")` | Kết thúc hội thoại |

### 👀 Vision
| Lệnh | Mô tả |
|-------|--------|
| `!lookAtPlayer("tên", "at"/"with")` | Nhìn vào/cùng hướng người chơi |
| `!lookAtPosition(x, y, z)` | Nhìn vào tọa độ |

### 🧪 Test & Debug
| Lệnh | Mô tả |
|-------|--------|
| `!skillSmokeHarness` | Kiểm tra kỹ năng cơ bản |
| `!scenarioRegressionSuite` | Test hồi quy kịch bản |

---

## 5. Chế độ tự động (Modes)

Modes là các hành vi tự động chạy mỗi tick (300ms). Bạn bật/tắt bằng `!setMode`.

| Mode | Mô tả | Mặc định (Survival) |
|------|--------|---------------------|
| `self_preservation` | Tự bảo vệ: chống đuối nước, tránh creeper, dùng nước khi cháy, chạy khi sắp chết | ✅ BẬT |
| `unstuck` | Tự gỡ kẹt khi đứng 1 chỗ quá lâu (20s) | ✅ BẬT |
| `cowardice` | BỎ CHẠY khi thấy quái (thay vì đánh) | ❌ TẮT |
| `self_defense` | TẤN CÔNG quái vào đánh tầm 8 block | ✅ BẬT |
| `hunting` | Săn thú (bò, lợn, gà) khi rảnh | ✅ BẬT |
| `item_collecting` | Nhặt item rơi gần đó | ✅ BẬT |
| `torch_placing` | Đặt đuốc khi tối và có đuốc | ✅ BẬT |
| `elbow_room` | Tránh đứng quá sát người chơi | ✅ BẬT |
| `idle_staring` | Nhìn xung quanh khi rảnh | ✅ BẬT |
| `cheat` | Dùng lệnh /give, /tp (cần server cho phép) | ❌ TẮT |

> **Lưu ý quan trọng**: `cowardice` và `self_defense` XUNG ĐỘT nhau. Chỉ bật 1 trong 2.
> - **Sinh tồn tích cực**: `self_defense: ON`, `cowardice: OFF`
> - **Sinh tồn an toàn**: `self_defense: OFF`, `cowardice: ON`

---

## 6. Hệ thống Reflex – Tự học phản xạ

Bot có khả năng **tự viết code phản xạ** dựa trên damage log nhận được.

### Cách hoạt động
1. Bot nhận damage → `DamageLogger` ghi log (kẻ tấn công, vị trí, hành động lúc đó)
2. Khi tích lũy đủ 6HP damage → `ReflexArchitect` phân tích patterns
3. AI tạo code phản xạ → `Validator` kiểm tra an toàn → lưu file `.js`
4. `ReflexLoader` tự động load và chạy reflex khi bị damage

### Ví dụ reflex tự học
- Bị zombie đánh nhiều → Bot tự viết code: trang bị sword + tấn công lại
- Bị skeleton bắn → Bot tự viết code: zigzag né tên + tiến lại gần
- Bị rơi xuống hố → Bot tự viết code: nhảy + dùng water bucket

---

## 7. Hệ thống Task Tree – Quản lý nhiệm vụ

Khi dùng `!startLongTermGoal`, bot sẽ tạo **cây nhiệm vụ phân cấp**:

```
Root: "Beat the Ender Dragon"
├── Phase 1: "Collect basic resources"
│   ├── "Get 64 wood logs"
│   ├── "Craft wooden tools" 
│   └── "Build shelter"
├── Phase 2: "Get iron equipment"
│   ├── "Mine 32 iron ore"
│   └── "Smelt and craft iron armor"
├── Phase 3: "Find fortress"
│   └── ...
└── Phase 4: "Kill Ender Dragon"
    └── ...
```

### HealthGate
Khi health ≤ 6 hoặc food ≤ 6, bot TỰ ĐỘNG tạm dừng nhiệm vụ hiện tại và ưu tiên ăn/hồi máu trước.

---

## 8. Hệ thống Confidence – Cảm xúc bot

Bot có "cảm xúc" ảnh hưởng đến quyết định:

| Yếu tố | Ảnh hưởng |
|---------|-----------|
| Health cao | ↑ Confidence |
| Có vũ khí (sword/trident) | ↑ Confidence |
| Có áo giáp | ↑ Confidence |
| Giết được quái | ↑ Confidence |
| Health thấp | ↓ Confidence |
| Chết nhiều | ↓ Confidence |

Confidence ảnh hưởng đến việc bot **dám mạo hiểm** hay **chọn an toàn**.

---

## 9. Memory Bank – Bộ nhớ không gian

Bot ghi nhớ vị trí các block quan trọng xung quanh:
- Quặng (iron, diamond, gold)
- Chest, crafting table, furnace
- Cây, nước, portal

Giới hạn tối đa **5000 entries** để tránh tràn bộ nhớ. Tự động lưu mỗi 5 phút.

---

## 10. Auto-Reconnect – Tự kết nối lại

Bot **TỰ ĐỘNG** reconnect khi bị disconnect:
- **Lỗi mạng** (timeout, connection lost, reset): Reconnect với backoff tăng dần (2s → 4s → 8s → ... → max 60s)
- **Lỗi fatal** (banned, sai version, duplicate login): Dừng hẳn, không reconnect

---

## 11. 🎮 Chiến Lược Phá Đảo Game

### Bước 1: Chuẩn bị Profile

Chỉnh `profiles/freeguy.json` (hoặc tạo profile mới):

```json
{
    "name": "Freeguy",
    "model": "groq/llama-3.3-70b-versatile",
    "max_tokens": 8000,
    "modes": {
        "self_preservation": true,
        "self_defense": true,
        "hunting": true,
        "item_collecting": true,
        "torch_placing": true,
        "cowardice": false,
        "cheat": false
    }
}
```

### Bước 2: Chuẩn bị Settings

Chỉnh `settings.js`:

```js
const settings = {
    // ...server settings...
    "base_profile": "survival",
    "profiles": ["./profiles/freeguy.json"],
    "load_memory": true,              // ← BẬT: nhớ session trước
    "allow_insecure_coding": true,    // ← BẬT: cho bot tự viết code
    "max_messages": 15,
    "max_commands": -1,               // ← Không giới hạn lệnh liên tiếp
    "narrate_behavior": true,
}
```

### Bước 3: Khởi chạy và ra lệnh

```bash
node main.js
```

Khi bot vào game, gõ trong chat Minecraft:

```
!startLongTermGoal("Survive and beat the Ender Dragon. Start by collecting wood, making tools, building a shelter. Then mine for iron, make armor. Find diamonds, make diamond gear. Find a nether fortress, collect blaze rods and ender pearls. Find the End portal, activate it, and kill the Ender Dragon.")
```

Hoặc ngắn gọn hơn (bot hiểu tiếng Việt nếu dùng model tốt):

```
sinh tồn và phá đảo game
```

### Bước 4: Theo dõi và hỗ trợ

Trong quá trình bot chạy:

| Bạn muốn | Gõ lệnh |
|-----------|---------|
| Xem tiến độ | `!longTermGoalStatus` |
| Tạm dừng | `!pauseLongTermGoal(true)` |
| Tiếp tục | `!pauseLongTermGoal(false)` |
| Dừng hẳn | `!clearLongTermGoal` |
| Dạy bot kỹ năng mới | `!newAction("mô tả chi tiết hành động")` |
| Buộc bot ăn | `!consume("cooked_beef")` |
| Xem inventory | Gõ `inventory` hoặc `kho đồ` |
| Xem stats | Gõ `stats` hoặc `trang thái` |

### Bước 5: Mẹo để bot sống sót lâu dài

1. **Cho bot có shelter sớm**: Bot dễ chết ban đêm nếu không có nhà
2. **Tránh cho bot vào Nether quá sớm**: Cần ít nhất full iron armor
3. **Kiểm tra thường xuyên**: Mỗi 2-4 giờ kiểm tra xem bot có bị kẹt không
4. **Dùng `load_memory: true`**: Nếu bot restart, nó sẽ nhớ vị trí đã lưu
5. **Nếu bot chết liên tục**: 
   - Gõ `!setMode("cowardice", true)` để bot chạy thay vì đánh
   - Hoặc giúp bot craft armor tốt hơn
6. **Rate limit**: Nếu dùng Groq free, bot sẽ bị giới hạn sau vài giờ. Cân nhắc dùng model có paid tier

### Bước 6: Lệnh nhanh hữu ích khi chơi cùng

```
# Bảo bot đi theo
!followPlayer("TênBạn", 3)

# Bảo bot thu thập gỗ
!collectBlocks("oak_log", 64)

# Bảo bot craft bàn chế tạo
!craftRecipe("crafting_table", 1)

# Bảo bot nung sắt
!smeltItem("raw_iron", 16)

# Bảo bot trang bị kiếm
!equip("iron_sword")

# Xem chest gần nhất có gì
!viewChest

# Lưu vị trí nhà
!rememberHere("base")

# Về nhà
!goToRememberedPlace("base")
```

---

## ⚠️ Lưu ý quan trọng

1. **Groq free tier** có giới hạn requests/phút. Bot cao cấp nên dùng paid API
2. **`allow_insecure_coding: true`** cho phép bot chạy code trên máy bạn – chỉ bật trong môi trường tin cậy
3. **Auto-reconnect** chỉ hoạt động với lỗi mạng. Nếu server tắt hẳn, bot sẽ retry đến khi server bật lại
4. Bot **KHÔNG** phải AI hoàn hảo – nó sẽ mắc lỗi, đôi khi ngớ ngẩn. Đó là bình thường!
5. Thời gian để bot "phá đảo" phụ thuộc vào model AI và may mắn. Có thể mất **vài ngày** đến **vài tuần** liên tục chạy
