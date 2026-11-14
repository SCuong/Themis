// Shared mock conversation for the three Themis prototypes. Pure data: no API, nothing is sent anywhere.
// Times in history are minutes after 09:00 today; live round timings are ms after the round starts.
window.THEMIS_MOCK_DATA = {
  room: {
    id: 'launch-2-0',
    title: 'Ra mắt Themis 2.0',
    question: 'Có nên ship lên Chrome Web Store vào thứ Năm này không?',
    mode: 'Cộng tác',
  },

  members: [
    { id: 'linh', name: 'Linh', role: 'Product Lead', site: 'Gemini', monogram: 'L' },
    { id: 'khoa', name: 'Khoa', role: 'Staff Engineer', site: 'ChatGPT', monogram: 'K' },
    { id: 'mai', name: 'Mai', role: 'Growth', site: 'DeepSeek', monogram: 'M' },
    { id: 'rook', name: 'Rook', role: 'Phản biện', site: 'Claude', monogram: 'R' },
    { id: 'van', name: 'Vân', role: 'Product Designer', site: 'Grok', monogram: 'V' },
  ],

  // Finished messages from earlier in the session.
  history: [
    {
      id: 'u1', author: 'user', round: 1, minute: 12, to: 'all',
      text: '@all Themis 2.0 đã feature-complete. Có nên ship lên Chrome Web Store vào **thứ Năm** này không? Mỗi người cho một khuyến nghị rõ ràng và lý do.',
    },
    {
      id: 'h-linh-1', author: 'linh', round: 1, minute: 12, thinkMs: 6200, totalMs: 19400,
      text: `**Khuyến nghị: ship thứ Năm, nhưng theo từng nấc.**

Bản 2.0 không cần hoàn hảo để ra mắt; nó cần **có đường lui**. Tôi đề xuất phát hành theo ba nấc thay vì bật cho tất cả cùng lúc:

- Thứ Năm: 10% người dùng, chỉ những ai đã bật "Thử tính năng mới".
- Thứ Hai: 50% nếu tỉ lệ lỗi gửi prompt dưới 2%.
- Thứ Năm tuần sau: 100%.

Rollout theo phần trăm qua Chrome Web Store cho phép ta dừng lại bất cứ lúc nào mà không phải rút cả bản. Điều tôi sợ không phải một lỗi nhỏ, mà là mất nhịp: đội đã làm 2.0 sáu tuần, và mỗi tuần hoãn là một tuần người dùng tiếp tục dùng bản 1.x với luồng orchestration mà chính ta đã thấy là rối.

Rủi ro tôi chấp nhận: vài người trong nhóm 10% gặp lỗi frame. Rủi ro tôi không chấp nhận: ship mà không có số đo. Trước thứ Năm, ta cần dashboard tỉ lệ gửi thành công theo từng site.`,
    },
    {
      id: 'h-khoa-1', author: 'khoa', round: 1, minute: 13, thinkMs: 9800, totalMs: 31200,
      text: `**Khuyến nghị: chưa ship thứ Năm. Dời sang thứ Ba tuần sau.**

Lý do là dữ liệu, không phải cảm giác. Trong 20 lần chạy \`npm run test:e2e\` tuần này, Grok trượt **3 lần**, cả ba đều ở cùng một chỗ: rule DNR của tab chưa kịp áp dụng trước khi iframe tải.

\`\`\`text
e2e summary — 20 runs
  ChatGPT   20/20 PASS
  Gemini    20/20 PASS
  DeepSeek  19/20 PASS   (1 timeout, network)
  Claude    20/20 PASS
  Grok      17/20 PASS   (3x "Themis added no frame rule")
\`\`\`

15% thất bại trên một site không phải "lỗi nhỏ". Với người dùng, nó trông như Themis hỏng, không phải Grok hỏng.

Bản sửa đã rõ: chờ \`syncFrameRules\` resolve rồi mới gán \`src\` cho iframe. Việc sửa mất nửa ngày; việc chứng minh nó ổn mới tốn thời gian — tôi muốn **50 lần chạy sạch** trước khi ký. Thứ Ba cho ta đủ khoảng đó mà không phải làm đêm.

Tôi không phản đối rollout theo nấc của Linh. Tôi phản đối việc dùng nó để bù cho một lỗi đã biết.`,
    },
    {
      id: 'h-mai-1', author: 'mai', round: 1, minute: 13, thinkMs: 21500, totalMs: 40800,
      text: `**Khuyến nghị: ship thứ Năm. Cửa sổ ra mắt quan trọng hơn ta nghĩ.**

Ba thứ đã khóa lịch vào thứ Năm:

1. Bản tin gửi 4.200 người đăng ký chờ — đã lên lịch 9:00 thứ Năm.
2. Buổi demo trong cộng đồng dev Việt tối thứ Năm, 300+ người đã nhận lời.
3. Bài viết so sánh multi-agent của một kênh công nghệ, đăng thứ Sáu, có nhắc tên Themis.

Hoãn sang thứ Ba nghĩa là ba thứ trên hoặc trỏ tới bản cũ, hoặc phải dời theo — và người ta không dời lịch vì một extension.

Về con số của Khoa: 3/20 là thật, nhưng đó là **môi trường test**, chạy liên tục, không nghỉ. Người dùng thật mở Grok vài lần mỗi ngày. Tôi đề xuất ship thứ Năm *với Grok gắn nhãn "beta"* và sửa trong tuần.

Tăng trưởng không đến từ bản hoàn hảo. Nó đến từ việc có mặt đúng lúc người ta đang nhìn.`,
    },
    {
      id: 'h-rook-1', author: 'rook', round: 1, minute: 14, thinkMs: 7400, totalMs: 27900,
      text: `**Tôi nghĩ câu hỏi đang sai.** "Thứ Năm hay thứ Ba" quan trọng ít hơn hai thứ chưa ai nói tới.

**Một: thời gian duyệt.** Chrome Web Store thường duyệt bản cập nhật trong vài ngày. Muốn có mặt thứ Năm, ta phải nộp thứ Hai hoặc thứ Ba. Nghĩa là bản sửa Grok của Khoa — nếu làm sau thứ Ba — **không kịp vào bản thứ Năm dù ta muốn**. Cuộc tranh luận này thực ra đang chọn giữa "ship với lỗi Grok" và "ship thứ Ba".

**Hai: rollback.** Linh nói rollout theo phần trăm cho phép dừng lại. Dừng thì được, nhưng những người đã nhận bản lỗi sẽ giữ bản đó cho tới khi ta nộp bản mới và chờ duyệt lại. Đường lui chậm hơn ta tưởng.

Nên tôi không đứng về phía nào. Tôi đề nghị đổi câu hỏi thành: **"Bản ta nộp vào thứ Hai có đủ tốt để sống với nó một tuần không?"** Nếu có — ship. Nếu không — chuyện thứ Năm đã được quyết định thay ta.`,
    },
    {
      id: 'h-van-1', author: 'van', round: 1, minute: 14, thinkMs: 5100, totalMs: 16300,
      text: `**Khuyến nghị: ship được, nhưng sửa màn đầu tiên trước.**

Tôi xem lại 12 bản ghi phiên dùng thử. 7/12 người dừng ở bước đăng nhập các site trong frame — họ không hiểu vì sao phải đăng nhập Gemini *bên trong* Themis khi đã đăng nhập ở tab khác.

Đây không phải lỗi kỹ thuật, nhưng hậu quả giống hệt: người dùng nghĩ sản phẩm hỏng.

- Thêm một dòng giải thích ngay trên frame chưa đăng nhập.
- Đổi trạng thái rỗng từ "Chưa có tin nhắn" thành một gợi ý câu hỏi đầu tiên.
- Nút "Thử lại" của từng thành viên phải nói rõ sẽ gửi lại cho *ai*.

Ba việc này nằm gọn trong hai ngày. Ship thứ Năm hay thứ Ba, màn đầu tiên là thứ người ta nhớ.`,
    },
    {
      id: 'u2', author: 'user', round: 2, minute: 21, to: ['rook'],
      quote: { messageId: 'h-linh-1', memberId: 'linh', text: 'Rollout theo phần trăm qua Chrome Web Store cho phép ta dừng lại bất cứ lúc nào mà không phải rút cả bản.' },
      text: '@Rook phản biện đoạn này giúp tôi. Nếu Linh đúng thì ta có thể ship thứ Năm mà ít rủi ro.',
    },
    {
      id: 'h-rook-2', author: 'rook', round: 2, minute: 21, thinkMs: 8100, totalMs: 22600,
      quote: { messageId: 'h-linh-1', memberId: 'linh', text: 'Rollout theo phần trăm qua Chrome Web Store cho phép ta dừng lại bất cứ lúc nào mà không phải rút cả bản.' },
      text: `Đoạn này đúng một nửa, và nửa sai là nửa quan trọng.

**Đúng:** ta có thể dừng việc *phát thêm* bản mới cho người chưa nhận.

**Sai:** "không phải rút cả bản" ngầm hiểu rằng người đã nhận sẽ an toàn. Họ không an toàn. 10% người dùng sẽ ở lại với bản lỗi cho tới khi ta nộp bản vá và nó được duyệt — có thể vài ngày.

Vậy rollout theo nấc **giảm số người bị ảnh hưởng**, nhưng **không rút ngắn thời gian họ bị ảnh hưởng**. Với lỗi Grok, đó là 10% người dùng thấy một frame trống trong vài ngày.

Nếu muốn ship thứ Năm một cách trung thực, hãy làm thêm một việc: **tắt Grok bằng cờ cấu hình từ xa** cho tới khi bản sửa được duyệt. Khi đó nấc 10% mới thật sự là đường lui.`,
    },
  ],

  // Disagreements are marked by the user or by the room; never inferred by the UI.
  disagreements: [
    {
      id: 'd1', topic: 'Ngày ship', status: 'open',
      sides: [
        { memberId: 'mai', messageId: 'h-mai-1', stance: 'Thứ Năm', quote: 'Hoãn sang thứ Ba nghĩa là ba thứ trên hoặc trỏ tới bản cũ, hoặc phải dời theo.' },
        { memberId: 'khoa', messageId: 'h-khoa-1', stance: 'Thứ Ba', quote: '15% thất bại trên một site không phải "lỗi nhỏ". Với người dùng, nó trông như Themis hỏng.' },
      ],
    },
    {
      id: 'd2', topic: 'Rollout theo phần trăm có đủ làm đường lui?', status: 'open',
      sides: [
        { memberId: 'linh', messageId: 'h-linh-1', stance: 'Đủ', quote: 'Rollout theo phần trăm qua Chrome Web Store cho phép ta dừng lại bất cứ lúc nào mà không phải rút cả bản.' },
        { memberId: 'rook', messageId: 'h-rook-2', stance: 'Chưa đủ', quote: 'Rollout theo nấc giảm số người bị ảnh hưởng, nhưng không rút ngắn thời gian họ bị ảnh hưởng.' },
      ],
    },
  ],

  // The round that plays live when a prototype opens. delay = ms until first text, wps = words per second.
  liveRound: {
    prompt: {
      id: 'u3', author: 'user', round: 3, to: 'all',
      text: '@all Giả sử ta ship thứ Năm và tắt Grok bằng cờ từ xa như Rook đề xuất. Mỗi người: việc cụ thể của mình trong 48 giờ tới, dạng checklist ngắn.',
    },
    replies: [
      {
        memberId: 'linh', delay: 1800, wps: 14,
        text: `**48 giờ của tôi — để thứ Năm có số đo.**

- [ ] Dựng dashboard tỉ lệ gửi thành công theo từng site (thứ Ba, trưa).
- [ ] Viết tiêu chí "dừng rollout": lỗi gửi > 2% trong 2 giờ liên tiếp.
- [ ] Chốt với Mai nội dung bản tin: nói rõ Grok đang tạm tắt.
- [ ] Nộp bản lên Chrome Web Store **sáng thứ Hai**, như Rook nhắc.

Một điều tôi đổi ý sau khi đọc Rook: nấc đầu tiên sẽ là 5%, không phải 10%.`,
      },
      {
        memberId: 'khoa', delay: 4600, wps: 11,
        text: `**48 giờ của tôi — cờ tắt Grok và bản sửa frame rules.**

- [ ] Thêm cờ \`sites.grok.enabled\` đọc từ cấu hình từ xa, mặc định \`true\`.
- [ ] Ẩn Grok khỏi danh sách thêm thành viên khi cờ tắt; thành viên Grok đang có hiện trạng thái "Tạm tắt".
- [ ] Sửa thứ tự: chờ rule DNR rồi mới gán \`src\` cho iframe.
- [ ] Chạy \`npm run test:e2e\` 50 lần trên CI đêm thứ Hai.

\`\`\`ts
await syncFrameRules(tabId, members)   // phải xong trước
frame.src = siteUrl(member)            // rồi mới tải frame
\`\`\`

Nếu 50/50 sạch, tôi đề nghị bật lại Grok trong bản vá tuần sau.`,
      },
      {
        memberId: 'rook', delay: 7600, wps: 9,
        text: `**48 giờ của tôi — tìm chỗ kế hoạch này gãy.**

- [ ] Thử tắt cờ Grok giữa phiên: thành viên Grok đang trả lời thì sao?
- [ ] Kiểm tra bản tin của Mai có hứa điều gì bản thứ Năm không làm được.
- [ ] Viết sẵn một đoạn thông báo sự cố, để nếu phải dừng rollout thì không phải viết lúc 11 giờ đêm.

Tôi vẫn giữ một nghi ngờ: **5% là quá ít để thấy lỗi Grok**, nhưng Grok đã tắt nên điều đó giờ ít quan trọng hơn.`,
      },
      {
        memberId: 'van', delay: 5200, wps: 12, error: { at: 5200, text: 'Grok yêu cầu đăng nhập lại trong khung của Vân.' },
        retry: { delay: 2600, wps: 13 },
        text: `**48 giờ của tôi — màn đầu tiên.**

- [ ] Dòng giải thích trên frame chưa đăng nhập: "Themis mở Gemini ngay trong phòng này, nên cần bạn đăng nhập một lần ở đây."
- [ ] Trạng thái rỗng gợi ý câu hỏi đầu tiên theo vai trò của nhóm.
- [ ] Nút "Thử lại với <tên>" thay cho "Thử lại" chung chung.
- [ ] Trạng thái "Tạm tắt" cho thành viên Grok — xám, có giải thích, không trông như lỗi.

Trớ trêu: chính tôi vừa bị Grok đá ra khỏi phiên.`,
      },
      {
        memberId: 'mai', delay: 19500, wps: 12,
        text: `**48 giờ của tôi — ra mắt mà không hứa quá.**

- [ ] Viết lại bản tin: bỏ "hỗ trợ 5 AI", thay bằng "4 AI, Grok quay lại tuần sau".
- [ ] Chuẩn bị demo thứ Năm bằng ChatGPT, Gemini, Claude, DeepSeek — không chạm Grok trên sân khấu.
- [ ] Báo trước cho kênh công nghệ về Grok để bài thứ Sáu không viết sai.

Nhưng tôi phải phản đối Khoa ở một điểm: **50 lần chạy CI đêm thứ Hai là không đủ thời gian** nếu lần đầu đã đỏ. Ta nên bắt đầu từ tối nay.`,
      },
    ],
    // After everyone is done: a follow-up that opens a new disagreement.
    followUp: {
      at: 6500, memberId: 'khoa', replyTo: 'mai',
      quote: { memberId: 'mai', text: '50 lần chạy CI đêm thứ Hai là không đủ thời gian nếu lần đầu đã đỏ.' },
      text: `Mai đúng về thời điểm. Tôi sẽ chạy loạt đầu tiên **tối nay**, nhưng vẫn giữ con số 50: chạy ít hơn thì ta chỉ đang hy vọng chứ không phải đo.`,
      wps: 12, delay: 2400,
      disagreement: {
        id: 'd3', topic: 'Bao nhiêu lần chạy e2e là đủ?', status: 'open',
        sides: [
          { memberId: 'khoa', stance: '50 lần, bắt đầu tối nay', quote: 'Chạy ít hơn thì ta chỉ đang hy vọng chứ không phải đo.' },
          { memberId: 'mai', stance: 'Không kịp nếu lần đầu đỏ', quote: '50 lần chạy CI đêm thứ Hai là không đủ thời gian nếu lần đầu đã đỏ.' },
        ],
      },
    },
  },

  // Replies for anything the user sends from a composer. {q} is replaced with the start of the user's text.
  cannedReplies: {
    linh: 'Về "{q}": tôi sẽ đo trước rồi mới quyết.\n\n- Tiêu chí thành công là gì?\n- Ai sở hữu con số đó?\n- Khi nào ta dừng lại?\n\nNếu ba câu này có câu trả lời, tôi đồng ý đi tiếp.',
    khoa: 'Đã đọc "{q}". Về mặt kỹ thuật thì làm được, nhưng tôi cần thấy nó chạy trên CI trước.\n\n```text\nnpm test        # nhanh, chạy trên mọi commit\nnpm run test:e2e # chậm, cần profile đăng nhập\n```\n\nTôi sẽ báo lại khi có kết quả.',
    mai: 'Về "{q}": câu hỏi của tôi luôn là — người dùng sẽ *thấy* gì khác? Nếu câu trả lời là "không gì cả", ta đang tối ưu cho chính mình.\n\nTôi đề xuất thử với 5 người dùng thật trước khi đầu tư thêm.',
    rook: 'Tôi sẽ phản biện "{q}" theo cách quen thuộc: điều gì phải đúng để ý này sai?\n\n**Giả định ẩn:** mọi người trong phòng hiểu câu hỏi giống nhau. Tôi không chắc. Hãy viết lại câu hỏi bằng một câu, rồi xem có ai đọc ra nghĩa khác không.',
    van: 'Về "{q}": tôi sẽ phác ba phương án trong một giờ — một an toàn, một táo bạo, một lạ. Chọn bằng mắt nhanh hơn chọn bằng lời.\n\n- Phương án A giữ bố cục hiện tại.\n- Phương án B đổi điểm vào.\n- Phương án C bỏ hẳn một bước.',
  },
};
