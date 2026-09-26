# 公式sourceのscheduled運用（Phase 1）

このrunbookでは、すでに動作しているshadow sourceをscheduled ingestionへ昇格する手順を扱います。scheduled runはreview candidateを
stageするだけであり、catalog dataを自動でapprove、apply、deleteすることはありません。Issue #634でrolloutを追跡します。

## 現在のrollout状態

- `scheduledEnabled: true`なのはKabuki EventとShochiku Ticketだけで、他のsourceはすべてunscheduledです。運用観測を早めるため、両sourceを一時的に日次（毎日09:00 JST）のdue slotで取得します。両sourceで連続するscheduled runの結果を確認した後、安定していれば同じPRで両方を週次へ戻します。片方だけ先に週次へ戻し、もう片方だけが日次で動く期間を作りません。
- `ticket.shochiku.schedule`は短期の日次shadow試行中です。そのadapterは、まず公開されているKabuki-bitoのplay detailにあるticket開始時刻を
  general saleの暫定evidenceとして読み、その後Shochiku東西のsale rowを読みます。同じEventのgeneral saleは1つのsource/run内でreconcileします。
  Shochikuの日付が後から変われば暫定日付を置き換えますが、同じ日のShochiku date-only rowによってKabuki-bitoが明示した時刻を消すことは
  ありません。Shochikuの会員tierは別々のopportunityとして扱います。titleの異なるproductionをsubstringだけで紐付けません。Event identityを
  解決できない場合はreview-blockedのままとし、approval/applyは自動化しません。creatorの`/catalog/imports` pageには、ticket用の別個のmanual
  shadow buttonと最新のheld-page reportがあります。2026-09-25のread-only live scanでは、異なるticket draftを71件解析しました。Kabuki-bito
  detail pageから13件、Shochiku東西から58件で、held play pageは0件でした。Kabukiza #986では[official ticket section](https://www.kabuki-bito.jp/theaters/kabukiza/play/986)
  からgeneral sale 2026-10-14 10:00 JSTを取得しました。このread-only scan自体はProduction candidateをstageしていません。その後、operatorは
  Production手動取得の候補を一通り確認・整理し、変更なし再取得で追加差分が出なかったことを2026-09-27に報告しました。このevidenceを基に、
  短期の日次shadow試行へ昇格しています。[Shochiku terms](https://www1.ticket-web-shochiku.com/t/info/rules.html)はsite contentの権利を留保しています。
  2026-09-27の再確認でも`/robots.txt`は404でしたが、これは許可を示すものではありません。operatorが指定したprivate-household境界内で正規化済みfactと
  source linkだけを再利用し、pageのprose、image、raw HTMLを保持または再公開してはなりません。初回のscheduled runから、source別のcandidate、
  held、failure、request量を観測します。adapterはKabuki-bitoのindexと最大30 detail page、Shochikuの東西2 pageに範囲を制限します。
  同じCronがEventを先に取得し、そのWorkflow stepが完了してからTicketを取得するため、合計のaccess量も確認します。Eventのstepが失敗してもTicketは試行し、失敗したsourceはrun結果に残します。追加のCronやsecretは不要です。
- Production専用machine-auth routeは正確に`/api/official-import/cron`です。proxyによりSupabase user sessionがなくてもこのpathからroute handlerへ
  到達できますが、handlerは引き続き`CRON_SECRET` bearerを要求します。この例外は`/api/official-import/shadow`や他のapplication/API pathには
  適用されません。`apps/web/vercel.json`には毎日00:00 UTCのCron callが1つ登録されています。日次試行中はKabuki EventとShochiku Ticketが毎日dueとなり、Eventの取得完了後にTicketの取得を開始します。週次に戻した後も同じ順序です。他sourceはdueになりません。Cronは
  sourceをapproveもapplyもしません。
- このrouteには32文字以上のProduction `CRON_SECRET`とVercelの`Authorization: Bearer <secret>` headerが必要です。設定がなければfail closedと
  なります。値をrepository、PR、logに保存または表示してはなりません。
- daily Cron slotはAsia/Tokyoの日付を使います。weekly sourceのdue日はAsia/Tokyoの月曜日だけです。同じslotが重複配信されても同じdurable run
  identityを使います。databaseはsourceごとに稼働中のattempt leaseを1つだけ許可し、完了runから変化のないcandidateを抑止します。activeなWorkflow
  stepはacquiringとplanningの間、自身のleaseを更新します。candidate commit、failure、releaseの前に更新を停止して完了させ、遅れて届いた更新が
  release済みattemptを取り戻せないようにします。更新に失敗したら追加heartbeatを止め、まだ所有中のleaseを条件付きでreleaseしてからretryします。
- 初期rolloutの優先順（2026-09-23）はKabuki Eventを最初に週次運用することです。adapterはscan対象をplay page 30件に制限し、batch間に
  pauseを入れながら一度に最大2件取得します。indexが上限を超えた場合、黙って切り詰めずfail closedとします。
  2026-09-24のread-only canaryではteaserの重複、月だけ示された将来listing、detailごとに異なるscheduleが見つかりました。日付ごとの明示的な
  headline時刻は、showを推測で作らず、掲載range内の全日付が網羅される場合に限り解析できます。daily calendarのないpageでは、明示的な上演期間と
  標準の部別時刻（または単独の無label時刻）を展開できるのは、全休演日と部別のprivate例外を完全に解析できた場合だけです。学校団体観劇に関する
  正確なnoteは案内情報であると検証済みであり、公開Occurrenceを除外しません。不明なnoteと日付固有の変更はfail closedです。完全に検証済みの
  おおよその終演時刻noteは、暫定Occurrence終了時刻とsource確認memoを提供します。noteがない場合や形式不正の場合に終了時刻を作ることはありません。
  各幕の`上演時間` sectionを優先しますが、終演時刻を提供できるのは観測済みの公式timetable構造を満たす場合に限られます。各部名または明示的な
  開演時刻headerが検証済みheadline開演時刻と一致し、各幕に読み取り可能な時間rangeがあり、footerを認識できる必要があります。検証済みdaily
  calendarでこれらの終了時刻を使えるのは、上演されるすべてのcellが該当部のheadline時刻を明示的に繰り返す場合に限られます。演目markerや日ごとに
  異なる開演時刻には一律の終了時刻を付与しません。`上演時間` sectionが存在するのに読み取れない場合は、human reviewのためpageをholdします。sectionが
  なければ検証済みのおおよその終了時刻を維持します。
  既存Occurrenceに終了時刻があり、最新proposalを解析しても同じ開演時刻について検証済み終了時刻が得られない場合、そのplayの更新をstageしません。
  pageを`published_end_missing`として報告し、人が確認するまでcatalogの終了時刻を維持します。このreportは過去のcandidateを自動で取り消しません。
  approvalとcatalog applyは人が別々に行います。古いcandidateに対処する前に最新のofficial pageとheld reportを確認します。
  stageされた終了時刻にもhuman reviewが必要です。単月のdaily calendarを読み取るのは、許可されたheadline note全体とPC/mobile両方のtable viewが、
  各日・各部について一致する場合だけです。A/B演目および丸印markerはその部の明示的な基準時刻を使い、数値cellはそれぞれの正確な時刻を維持します。
  不明なtable記号、note、または既知のnote形式同士の未知の組み合わせは、別途検証されるまでholdします。
  数値時刻についた単独の`★`は、同じ日付/部markerが両calendar viewに現れ、headline noteとcalendar footerが対象を示す内容で一致し、noteにschedule変更を
  示す文言がない場合に限り、その正確な時刻を維持してよいものとします。この場合candidateにはreview/apply前にofficial pageを確認する固定reminderを
  含めますが、note本文自体はcandidateに複製しません。noteがない、一致しない、または時刻変更を示す場合は引き続きholdします。これは観測された
  Asakusa #1000の注記に対応するもので、将来の注記もすべて問題ないと仮定するものではありません。
  Kabukiza #986とMinamiza #965で観測された非schedule本文は、正規化後の完全一致fingerprintでのみ受け入れます。tableが変わっていなくても、これらの
  noteに変更があればpageをhuman reviewのためholdします。
  tableの時刻をheadlineから推測してはなりません。正確な日付があり公開された開演時刻もcalendarもないpageが、Occurrence 0件のEvent-only
  candidateを生成できるのは、timetableが空、休演日listが検証済み、またはKabukiza #997で観測された非schedule noteのfingerprintが正確に一致する場合に
  限られます。部だけを記載したnoteを含む他のnoticeはholdのままにし、月だけ示されたteaserはskipします。開演時刻が公開済みの場合やscheduleを解決
  できない場合、Event-onlyへ格下げしてはなりません。
  厳格なschedule解析に失敗したdetail pageは、検証済みの関連pageがreview candidateをstageする一方でheld pageとして報告できます。held recordに含めるのは
  official URL、id、title、日付range、範囲を限定したreason codeだけであり、raw pageやerror本文は含みません。index、fetch/provider、ownershipのfailureは
  引き続きrun全体を失敗させます。partial runが完了しただけではclean promotion canaryとは**みなせません**。正確な日付を持つindex rowすべてについて
  stage済みまたはheldのidentityと照合し、主要theaterのcoverageとhold理由を調べ、除外内容をoperatorが受け入れたことを記録してからscheduleします。
  月だけ示すteaserは引き続き除外します。2026-09-25のread-only full-index auditでは、重複しないplay linkが26件見つかりました。正確な日付のrowは21件で、
  時刻付きproposalが15件、Event-only proposalが5件、London現地時刻のheld page（#1006）が1件でした。Kabukiza、Minamiza、Misonoza、Hakatazaにある正確な
  日付付きpageは全14件を、時刻付きまたはEvent-onlyとして説明できました。operatorは#1006をholdのままにすることを受け入れ、その後の変更なしmanual
  Production runで新しいcandidateが作られなかったことを確認しました。30-linkのindex上限はfail-closedの運用監視点として維持します。
  Takarazuka Eventにも週次cadenceの希望がありますが、まだscheduleされていません。private-householdのproduct境界は[#681](https://github.com/reitojike/stage-tracker/issues/681)
  で確定し、Cron machine-authの正確なpathは[#682](https://github.com/reitojike/stage-tracker/issues/682)で実装されています。
  [Issue #677](https://github.com/reitojike/stage-tracker/issues/677#issuecomment-5796382733)では、後日行う範囲限定のprivate-household・facts-only rolloutは
  妥当と判断されましたが、自動的に許可されたわけではありません。昇格前に[official site policy](https://kageki.hankyu.co.jp/rules.html)を再確認し、
  site policyに関して残る不確実性をoperatorが受け入れたことを記録し、source固有の厳格なrequest上限を適用し、個別のclean shadow canaryを完了してください。

## sourceごとの昇格gate

`scheduledEnabled` flagを変更する前に、そのsourceのrollout PRまたはIssue commentへevidenceを記録します。次のすべてが必須です。

1. operatorがsource固有のterms、robots指示、対象の公開page/APIへのaccess許可、適切なrequest cadence/rate limitを確認済みであること。
   技術的に到達可能であることはpolicy上の許可を意味しません。
2. adapterが現行official contentに対するcleanで上限付きのshadow canaryを実施済みであること: 物理eventとの関連性、Event/Occurrence/ticketの
   精度、paginationまたはpage coverageの完全性、時刻を推測で作らないこと、曖昧または形式不正なdataでfail closedとなること。page単位のhold reportを
   行うsourceでは、正確な日付のindex rowすべてを、検証済みcandidateまたは明示的なheld pageとして説明できなければなりません。正常終了を完全な
   coverageの証明とせず、計測された欠落を確認します。
3. 安定したsource identityとcontent-hash behaviorが実証されていること。変化のない2回目のrunでは重複review candidateを0件stageし、contentまたは
   planに変更があれば引き続きreview可能であること。該当する場合はretry、provider failure、sourceをまたぐ同一Eventのevidenceも含めます。
4. sourceがすでに`enabled: true`、`shadow: true`、`policyState: "approved"`であること。`planned`または`hold`のsourceを`scheduledEnabled`だけの
   変更で昇格することはできません。
5. raw HTML、PDF byte、provider responseをdurable candidateとして保持しないこと。reviewとapplyは引き続き人のgateを必要とします。

一度に昇格するsourceは1つだけにします。VpassとTakarazuka Friends PDF sourceは、それぞれのpolicyおよびextraction gateを通過するまでdisabledの
ままにします。終日calendar recordだけでは、正確な開演時刻も物理eventとの関連性も確定しません。

Kabukiをmanual Production shadow checkする場合、designated catalog creatorは`/catalog/imports`を開き、**歌舞伎を手動取得**を1回選択できます。
これは`event.kabuki-bito.schedule`だけを開始し、candidateをapproveまたはapplyしません。Workflowの完了を待ち、pageをrefreshし、次のrunの前に
candidate queueと最新held-page reportの両方を確認してください。このbuttonはsourceごとの別個のscheduling gateの代わりにはなりません。

Event identityがblockedされたTicketOpportunityについて、sourceがその情報を提供する場合、`/catalog/imports`は同じvenue・yearの候補Eventを最大5件
表示します。これはsuggestionであり、自動matchではありません。選択前にofficial pageのtitleと期間をEventと比較します。適切な候補がなければ、既存の
catalog Event URLまたはUUIDを貼り付け、previewを確認してから**このEventに紐づけて承認**を選びます。これは同じticket source identityの後続scanに
使う確認済みbindingを記録しますが、ticketをapplyするものではありません。**カタログへ反映**は別の手順です。`source_key`のないactiveな手動登録Eventも
bindingでき、確認済みEvent IDを保持します。cancelled/deletedされたEvent、またはidentityが変わったEventは、黙って別のEventへredirectせず、再びholdします。
sourceが実際には別performanceを示す場合、似ているだけのEventを選択しないでください。
manual binding済みcandidateが既存TicketOpportunityを更新する場合、未解決candidateにはその更新内容がreview用に表示されていなかったため、applyは
`source_changed`で停止します。ticket scanを再実行し、新たに解決された変更を確認してからapproveしてください。
approved candidateのapplyが失敗し、operatorが追加対応は不要と確認した場合（例: より正確なTicketOpportunityがすでにcatalogにある場合）、
**対応不要として閉じる**を選択します。これによりactive review queueから取り除かれるのは失敗candidateだけです。approval、failure、closeしたactor、close時刻は
databaseに残ります。close操作でcatalog dataを削除したり、失敗したapplyをretryしたりすることはできません。新たなreviewが必要な変更には使用しないでください。

## 有効化と観測

1. [#682](https://github.com/reitojike/stage-tracker/issues/682)の、pathを限定したCron machine-auth/proxy実装を検証します。sessionless Cron requestは
   routeへ到達し、その他のprotected routeは引き続きdefault-denyでなければなりません。Vercel projectのProduction environment variableとして
   `CRON_SECRET`を登録します。これはingestion用Supabase secret keyとは別です。値ではなくvariable名と存在だけを確認してください。
2. source固有PRで、clear済みsourceの`scheduledEnabled`だけを`true`にします。最初のsourceでは、`apps/web/vercel.json`に
   `/api/official-import/cron`の日次UTC Cron登録を追加します。後続sourceは同じrouteとcodeで管理される日次/週次cadenceを使います。overlap/rate
   evidenceを再確認せず、sourceごとに別jobを登録してはなりません。
3. repositoryのpre-PR gateとpost-PR convergenceを実行します。merge後、Cronを有効と扱う前にProduction deploymentの成功を確認します。
4. 最初のdue slotを2回以上観測します: `official_import_runs`の件数とstatus、candidate/review/applyの結果、変更なしrunでcandidateが0件となるbehavior、
   failure分類、request量、provider costの概算。同じEventを扱う別々のofficial sourceがcatalog Eventを重複作成していないことを確認します。evidenceを#634に
   記録します。Kabuki Eventの日次試行は、各runのindex/detail coverage、held page、意図しない候補の増加、重複起動、fetch failureも確認し、安定を確認できたら週次cadenceへ戻します。問題が出たら週次を待たずにsourceを停止するか修正します。
5. acquisitionまたはpolicyのevidenceが後退した場合、rollback PRで`scheduledEnabled`を`false`に戻します。candidate approvalとcatalog applyは別操作の
   ままとし、rollback手段として使わないでください。

Vercel Cron deliveryは重複または遅延する場合があり、自動retryはありません。routeのsame-slot identityとdatabase lease guardで重複workを制限しますが、
exactly-once deliveryを前提とせず、operatorは失敗runや欠落runを確認してください。あるsourceのfailureによって、routeが他のdue sourceを試す処理を
停止してはなりません。
