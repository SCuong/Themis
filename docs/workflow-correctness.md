# Workflow correctness: lỗi đã sửa và kinh nghiệm

Nhánh `fix/workflow-correctness`, tháng 11/2026. Mã nguồn chính: `src/background/orchestrationRuntime.ts`.
Test hồi quy: `orchestration-correctness.test.cjs` (36 test, chạy trong `npm test`).
Kiểm thử trình duyệt: `workflow-fixture.browser.cjs` (không nằm trong `npm test`).

## 1. Bốn lỗi ban đầu

| Lỗi | Triệu chứng | Nguyên nhân gốc |
|---|---|---|
| #2 | Workflow báo Completed khi còn node chưa chạy | Node kế tiếp được *chọn* trong một lần cập nhật store nhưng chỉ được *ghi nhận* khi `startStage` chạy sau đó (tuần tự, có thể chờ iframe vài giây). Nhánh song song xong trước thấy "không còn node đang chạy" và gọi `completeRun`. |
| #3 | Node chỉ nối từ cổng Fail chạy ngay lúc bắt đầu | `rootStageIndices` bỏ qua cạnh Fail, nên node đích của Fail trông như node gốc. |
| #4 | Chat thường và workflow giẫm lên nhau | `startStage` ghi đè `role.lastPromptMessageId` của thành viên đang trả lời chat thường (phản hồi đó bị bỏ). `stopOrchestrationRun` dừng mọi thành viên đang `thinking`, kể cả người không thuộc workflow. |
| #8 | Xóa lịch sử khi đang chạy để lại run Running | `GROUP_CHAT_CLEAR_MESSAGES` không đụng tới run đang chạy, trong khi task message của run đã bị xóa. |

## 2. Quy tắc của engine sau khi sửa

Những quy tắc này là "hợp đồng" của `orchestrationRuntime.ts`. Sửa engine thì giữ chúng, và thêm test khi đổi.

**Giữ chỗ (reservation).** Mọi node được chọn để chạy được ghi ngay thành stage run `pending` *trong cùng lần cập nhật store* đã chọn nó (`reserveStageRuns`). `startStage` chỉ chạy khi có vé `pending` cho node đó, nên một lượt giữ chỗ không bao giờ khởi chạy hai lần. `hasRunningStageRuns` tính cả `pending`.

**Node sẵn sàng (`isStageReadyFromIncoming`).** Một node chờ khi:
- nó đang chạy/đã giữ chỗ;
- bất kỳ nguồn nào của nó, hoặc node nào ở thượng nguồn của nguồn đó, còn có thể chạy (đang chạy hoặc giữ chỗ);
- một nguồn trên đường thường (không qua Fail) chưa "cho qua" (`isEdgeSatisfied`): node thường cho qua khi xong; review cho qua cạnh Pass (và cạnh không gắn nhãn, vốn đi theo Pass) khi PASS, bị skip, hoặc FAIL nhưng `onMaxAttempts: 'continue'` ở lần cuối; cho qua cạnh Fail khi FAIL;
- trong vòng lặp, nguồn phải xong *sau* lần chạy gần nhất của node (kết quả của vòng trước không tính).

Nguồn chỉ chạy sau một review FAIL (fixer) chỉ được chờ khi nó còn có thể chạy.

**Chọn node kế tiếp (`advanceRun`).** Ứng viên = đích trực tiếp + các join đã từng phải chờ và giờ sẵn sàng (`deferredReadyStageIndices`, xét cả cạnh Fail). Mỗi lần chỉ giữ chỗ **một** node, ưu tiên thượng nguồn (node không bị ứng viên khác dẫn tới), rồi kiểm tra lại. Kết quả không phụ thuộc thứ tự node trong flow (đã thử cả 120 hoán vị).

**Kết thúc run.** Không còn gì để chạy thì: còn node lỗi *mới nhất* của chính nó → run ở `error` (vẫn active, Retry/Skip được); không thì Completed. Lỗi đã bị một lần chạy sau của cùng node thay thế không tính.

**Node gốc (`rootStageIndices`).** Node không có cạnh vào là gốc. Node chỉ có cạnh Fail đi vào thì chờ review, trừ khi run không thể tới nó bằng cách nào khác: khi đó nó là đầu một vòng sửa bài và được chạy từ đầu. Nhiều đầu vòng cùng dẫn tới nhau (B,C → review, Fail → B,C) đều chạy; đầu vòng nằm "phía sau" đầu khác (handler của Fail) thì chờ.

**Thành viên bận.** Thành viên đang `thinking` với prompt còn tồn tại chặn node (không giới hạn thời gian, không reload iframe). Việc chờ chạy nền, nên nút Run không bị treo. Muốn giải phóng thì Stop thành viên đó.

**Trạng thái error có thể retry.** Trong lúc run `error` nhưng còn active: phản hồi của node song song vẫn được ghi nhận (không đẩy run đi tiếp), prompt đang xếp hàng sau giới hạn site vẫn được gửi, slot giới hạn gửi được giữ. FAIL ở lần thử cuối với `stop` vẫn kết thúc run như đường thường.

**Dừng / lỗi / xóa lịch sử.** Stop, `failRun` (hết lượt review, chạm giới hạn số node) và xóa lịch sử dùng chung cách dọn: node đang chạy → skipped, chỉ dừng thành viên mà prompt hiện tại thuộc run (`stopRunRoles`), trả slot giới hạn gửi (DeepSeek cho phép 2 prompt cùng lúc). Stop đánh dấu `interrupted` để Resume chạy lại mọi nhánh bị cắt. Resume từ chối nếu task message đã bị xóa.

**Service worker khởi động lại.** Việc chờ thành viên bận / iframe chưa sẵn sàng chỉ nằm trong bộ nhớ. Khi worker khởi động, `resumeReservedOrchestrationStages` (gọi trong `index.ts`) chạy lại các vé `pending` của run active.

**Retry.** Không cắt bỏ các stage run phía sau (đó là nhánh song song). Không truyền stage id thì chọn node lỗi mới nhất, rồi đến node đang chạy. Retry/Skip cũng khởi chạy lại các vé `pending` bị bỏ dở khi run lỗi.

**Khung trạng thái (`orchestrationStatusView.ts`).** Chỉ đếm node đã thực thi (không đếm vé `pending` hay node bị Stop trước khi bắt đầu). Node hiện tại: lỗi mới nhất chưa bị thay thế → đang chạy → đang chờ.

## 3. Kiểm toán chéo với Codex (gpt-6.1-sol, reasoning high, sandbox chỉ đọc)

Sáu vòng, mỗi vòng Codex tự tái hiện; mọi phát hiện được chuyển thành test fail trước / đạt sau.

| Vòng | Số phát hiện | Nội dung chính |
|---|---|---|
| 1 | 9 | join trong nhánh Fail chạy sớm/2 lần; đầu ra review bỏ qua join; Retry cắt mất nhánh song song; Resume chỉ chạy lại một nhánh; đầu vòng song song bị bỏ; vé bị kẹt khi worker khởi động lại; phản hồi chậm >120 s bị ghi đè; Stop giữ slot DeepSeek; Continue sau khi xóa lịch sử hồi sinh run; đếm node sai |
| 2 | 4 (+1 chưa xong) | nhánh Fail dài ngắn khác nhau; cạnh Pass chạy sau FAIL; phản hồi trong lúc error làm Retry kẹt; xóa lịch sử giữ slot DeepSeek |
| 3 | 3 | lượt quét join chạy trước khi giữ chỗ đích trực tiếp; cạnh review không nhãn; FAIL ghi nhận trong lúc error không mở nhánh; Retry một node làm run Completed khi node khác còn lỗi |
| 4 | 3 | lượt quét giữ chỗ F và D cùng lúc; FAIL trong lúc error bỏ qua `stop`; bản ghi lỗi cũ giữ run ở error |
| 5 | 2 | lượt quét phụ thuộc thứ tự node; `failRun` bỏ rơi node song song và slot |
| 6 | 1 | trả slot khi run lỗi nhưng còn retry được |

Trạng thái cuối: #3, #8 được Codex xác nhận; #2, #4 sửa xong mọi trường hợp đã tái hiện, riêng bản sửa vòng 6 chưa được Codex kiểm lại.

## 4. Cách kiểm thử

```bash
npm run build
npm run check
npm test
node workflow-fixture.browser.cjs
```

- `orchestration-correctness.test.cjs` dùng `prompt-sync-harness.cjs`: nạp `dist/background.js` thật với `chrome` giả, phản hồi do test tự gửi nên thứ tự race được kiểm soát. Nhớ `npm run build` trước.
- `workflow-fixture.browser.cjs` chạy Chromium của Playwright với extension thật và một server OpenAI-compatible **giả** ở localhost giữ từng request lại cho test thả. Đây là FIXTURE, không phải provider thật. `WORKFLOW_E2E_OUT=<tên>` đổi thư mục kết quả trong `test-results/`.
- Bằng chứng trước/sau đã chụp: `test-results/workflow-e2e/` và `test-results/workflow-e2e-before-fix/` (gitignored).

## 5. Kinh nghiệm

**Về engine**
- Quyết định và ghi nhận phải nằm trong *cùng* một lần `mutateStore`. Mọi khoảng hở giữa hai lần (một `await` ở giữa) là chỗ cho race. Đây là gốc của #2.
- "Kết thúc" cần định nghĩa chính xác: run `error` nhưng còn active là đang chờ Retry, không phải đã xong (vòng 6).
- Mỗi lối tắt kiểu "ghi lại trước, quyết định sau" (ghi phản hồi trong lúc error) phải lặp lại mọi kiểm tra của đường chính: giới hạn lượt review, thứ tự giữ chỗ, bản ghi nào còn hiệu lực. Vòng 3–4 đều đến từ đây.
- Logic "khi nào node sẵn sàng" là phần rủi ro nhất. Test theo *dạng graph* (song song, join, nhánh Fail, vòng lặp, thứ tự node đảo) có giá trị hơn test theo từng hàm.
- Mọi cách kết thúc run (Stop, lỗi, xóa lịch sử, giới hạn số node) nên đi qua cùng một bước dọn dẹp, kể cả slot giới hạn gửi theo site.

**Về kiểm thử**
- Luôn chứng minh test bắt được lỗi: chạy test mới trên code cũ (hoặc bản sửa vòng trước), thấy fail, rồi mới tính là đã sửa.
- Dùng `prompt-sync-harness` để tạo race có kiểm soát; dùng frame chưa sẵn sàng hoặc thành viên bận để làm một nhánh khởi động muộn.
- Trong harness, lệnh bắt đầu run và một số reply chờ cả việc dispatch node tiếp theo. Đừng `await` chúng; gửi rồi poll trạng thái.

**Bẫy khi lái giao diện bằng Playwright**
- Giao diện mặc định tiếng Việt: đừng tìm nút theo chữ tiếng Anh ("Stop", "Clear messages"). Dùng class (`.orchestration-status-window-actions .btn-danger`) hoặc regex hai ngôn ngữ.
- Workflow chỉ có trong chat collaborative. Context sync phát lại tin cũ, nên khi nhận diện request trong server giả, lấy token xuất hiện *cuối cùng*.
- Thành viên vừa chuyển sang model API giữ trạng thái `pending` tới lần dùng đầu tiên, và composer không cho gửi tới họ.
- Lưu model API qua form sẽ mở hộp thoại xin quyền host của Chrome (automation không bấm được). Đăng ký bằng runtime message `EXTERNAL_MODEL_CREATE`, rồi ghi rõ trong báo cáo.
- API client (`externalModelClient.complete`) tự hủy sau 30 s. Test giữ request lâu hơn sẽ thấy lỗi "model returned no text", không phải lỗi workflow.
- Console của service worker không được Playwright chuyển tiếp; đọc trạng thái qua `GROUP_STORE_GET` thay vì log.
- `ui-redesign.test.cjs` thỉnh thoảng lỗi khi chạy song song (sidebar che nút ở viewport hẹp); chạy riêng thì đạt.

**Về kiểm toán chéo**
- Codex CLI: `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only`. Sandbox chỉ đọc chặn spawn tiến trình con, nên Codex chạy test bằng loader trong bộ nhớ.
- Yêu cầu Codex chỉ báo lỗi có tái hiện hoặc đường code cụ thể; mỗi vòng sau chỉ xét các thay đổi mới. Dừng khi không còn bằng chứng mới hoặc khi người dùng yêu cầu.

## 6. Còn mở

- Chưa chạy E2E với provider thật (`npm run test:e2e` cần profile đã đăng nhập).
- Giới hạn gửi DeepSeek mới chỉ kiểm bằng `chrome` giả.
- Bản sửa vòng 6 (slot trong lúc error) chưa được Codex kiểm lại.
- Ngoài phạm vi, chưa sửa: timeout 30 s của API client; thành viên API ở trạng thái `pending` sau khi chuyển model; `detectAndHandleStaleRuns` không có nơi gọi.
