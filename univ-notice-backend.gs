/**
 * [DEPRECATED] 대학 공지는 GitHub Actions 로 이전됨.
 * 사용: scripts/build_univ_notices.py + .github/workflows/univ-notices.yml
 * 사이트는 Apps Script 없이 univ-board-data.js / data/univ-notices.json 만 사용합니다.
 *
 * 아래는 참고용 보관본입니다. 새로 배포하지 마세요.
 */

var NOTICE_SHEET = "notices";
var META_SHEET = "meta";
var MIN_DATE_ISO = "2026-08-01";
var BATCH_SIZE = 18;
var MAX_ITEMS_PER_SOURCE = 12;
var MAX_CACHED_ITEMS = 800;

var UNIV_SOURCES = [
  { id: "u001", name: "가톨릭대(성신)", homeUrl: "http://ipsi.catholic.ac.kr/", boardUrl: "https://ipsi.catholic.ac.kr/admission/html/notice/notice.asp" },
  { id: "u002", name: "가톨릭대(성의)", homeUrl: "http://ipsi.catholic.ac.kr/", boardUrl: "https://ipsi.catholic.ac.kr/admission/html/notice/notice.asp" },
  { id: "u003", name: "감리교신대", homeUrl: "https://www.mtu.ac.kr/mtu/main/main.do?mId=1", boardUrl: "" },
  { id: "u004", name: "건국대(서울)", homeUrl: "http://enter.konkuk.ac.kr/", boardUrl: "https://enter.konkuk.ac.kr/se/notice" },
  { id: "u005", name: "경기대(서울)", homeUrl: "http://enter.kyonggi.ac.kr/", boardUrl: "https://enter.kyonggi.ac.kr/notice" },
  { id: "u006", name: "경희대(서울)", homeUrl: "https://iphak.khu.ac.kr/main.do", boardUrl: "https://iphak.khu.ac.kr/notice/notice.do" },
  { id: "u007", name: "고려대(안암)", homeUrl: "http://oku.korea.ac.kr/", boardUrl: "https://oku.korea.ac.kr/oku/cms/FR_CON/index.do?MENU_ID=590" },
  { id: "u008", name: "광운대", homeUrl: "http://iphak.kw.ac.kr/", boardUrl: "https://iphak.kw.ac.kr/notice/noticeList.do" },
  { id: "u009", name: "국민대", homeUrl: "http://admission.kookmin.ac.kr/index.php?noMobile=1", boardUrl: "https://admission.kookmin.ac.kr/admission/html/notice/notice.asp" },
  { id: "u010", name: "덕성여대", homeUrl: "http://enter.duksung.ac.kr/", boardUrl: "https://enter.duksung.ac.kr/notice" },
  { id: "u011", name: "동국대(서울)", homeUrl: "https://ipsi.dongguk.edu/", boardUrl: "https://ipsi.dongguk.edu/" },
  { id: "u012", name: "동덕여대", homeUrl: "http://ipsi.dongduk.ac.kr/", boardUrl: "https://ipsi.dongduk.ac.kr/notice" },
  { id: "u013", name: "명지대(서울)", homeUrl: "http://ipsi.mju.ac.kr/", boardUrl: "https://ipsi.mju.ac.kr/notice" },
  { id: "u014", name: "삼육대", homeUrl: "http://ipsi.syu.ac.kr/", boardUrl: "https://ipsi.syu.ac.kr/notice" },
  { id: "u015", name: "상명대(서울)", homeUrl: "http://admission.smu.ac.kr/seoul/index.php", boardUrl: "https://admission.smu.ac.kr/seoul/notice" },
  { id: "u016", name: "서강대", homeUrl: "http://admission.sogang.ac.kr/", boardUrl: "https://admission.sogang.ac.kr/admission/html/notice/notice.asp" },
  { id: "u017", name: "서경대", homeUrl: "https://go.skuniv.ac.kr/#main", boardUrl: "" },
  { id: "u018", name: "서울과학기술대", homeUrl: "http://admission.seoultech.ac.kr/", boardUrl: "" },
  { id: "u019", name: "서울교대", homeUrl: "http://admission.snue.ac.kr/", boardUrl: "" },
  { id: "u020", name: "서울기독대", homeUrl: "http://www.scu.ac.kr/entrance/recruit_2018.php", boardUrl: "" },
  { id: "u021", name: "서울대", homeUrl: "http://admission.snu.ac.kr/", boardUrl: "https://admission.snu.ac.kr/undergraduate/notice" },
  { id: "u022", name: "서울시립대", homeUrl: "http://iphak.uos.ac.kr/", boardUrl: "https://iphak.uos.ac.kr/ips/notice/notice.do" },
  { id: "u023", name: "서울여대", homeUrl: "http://admission.swu.ac.kr/", boardUrl: "https://admission.swu.ac.kr/notice" },
  { id: "u024", name: "서울한영대", homeUrl: "https://ipsi.shyu.ac.kr/fro_end/html/main/", boardUrl: "" },
  { id: "u025", name: "성균관대", homeUrl: "https://admission.skku.edu/", boardUrl: "https://admission.skku.edu/admission/notice.htm" },
  { id: "u026", name: "성공회대", homeUrl: "http://enter.skhu.ac.kr/", boardUrl: "" },
  { id: "u027", name: "성신여대", homeUrl: "http://ipsi.sungshin.ac.kr/", boardUrl: "https://ipsi.sungshin.ac.kr/notice" },
  { id: "u028", name: "세종대", homeUrl: "http://ipsi.sejong.ac.kr/", boardUrl: "https://ipsi.sejong.ac.kr/notice/noticeList.do" },
  { id: "u029", name: "숙명여대", homeUrl: "https://admission.sookmyung.ac.kr/", boardUrl: "https://admission.sookmyung.ac.kr/admission/html/notice/notice.asp" },
  { id: "u030", name: "숭실대", homeUrl: "https://iphak.ssu.ac.kr/", boardUrl: "https://iphak.ssu.ac.kr/bachelor/notice" },
  { id: "u031", name: "연세대(서울)", homeUrl: "https://admission.yonsei.ac.kr/seoul/admission/html/main/main.asp", boardUrl: "https://admission.yonsei.ac.kr/seoul/admission/html/main/main.asp" },
  { id: "u032", name: "육군사관학교", homeUrl: "http://www.kma.ac.kr/", boardUrl: "https://www.kma.ac.kr/kma/160/subview.do" },
  { id: "u033", name: "이화여대", homeUrl: "http://admission.ewha.ac.kr/", boardUrl: "https://admission.ewha.ac.kr/admission/html/notice/notice.asp" },
  { id: "u034", name: "장로회신대", homeUrl: "https://www.puts.ac.kr/ipsi/db/db_admission_v1/", boardUrl: "" },
  { id: "u035", name: "중앙대(서울)", homeUrl: "http://admission.cau.ac.kr/", boardUrl: "https://admission.cau.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN021" },
  { id: "u036", name: "총신대", homeUrl: "http://admission.chongshin.ac.kr/", boardUrl: "" },
  { id: "u037", name: "추계예대", homeUrl: "https://enter.chugye.ac.kr/", boardUrl: "" },
  { id: "u038", name: "한국성서대", homeUrl: "https://ipsi.bible.ac.kr/", boardUrl: "" },
  { id: "u039", name: "한국외대(서울)", homeUrl: "http://adms.hufs.ac.kr/", boardUrl: "https://adms.hufs.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN036" },
  { id: "u040", name: "한국체대", homeUrl: "https://ipsi.knsu.ac.kr/", boardUrl: "" },
  { id: "u041", name: "한성대", homeUrl: "http://enter.hansung.ac.kr/", boardUrl: "" },
  { id: "u042", name: "한양대(서울)", homeUrl: "https://go.hanyang.ac.kr/", boardUrl: "https://go.hanyang.ac.kr/new/notice" },
  { id: "u043", name: "홍익대(서울)", homeUrl: "https://www.hongik.ac.kr/kr/admission/undergraduate-admission.do", boardUrl: "https://www.hongik.ac.kr/kr/admission/notice.do" },
  { id: "u044", name: "한예종", homeUrl: "https://www.karts.ac.kr/index_karts.jsp", boardUrl: "" },
  { id: "u045", name: "구) KC대 / 강서대", homeUrl: "https://entrance.gangseo.ac.kr/kcui/mainService", boardUrl: "" },
  { id: "u046", name: "가천대(글로벌)", homeUrl: "http://admission.gachon.ac.kr/admission/html/main/main.asp", boardUrl: "https://admission.gachon.ac.kr/admission/html/counsel/notice.asp" },
  { id: "u047", name: "가톨릭대(성심)", homeUrl: "http://ipsi.catholic.ac.kr/", boardUrl: "https://ipsi.catholic.ac.kr/admission/html/notice/notice.asp" },
  { id: "u048", name: "강남대", homeUrl: "http://admission.kangnam.ac.kr/", boardUrl: "" },
  { id: "u049", name: "경기대(수원)", homeUrl: "http://enter.kyonggi.ac.kr/", boardUrl: "https://enter.kyonggi.ac.kr/notice" },
  { id: "u050", name: "경동대(양주)", homeUrl: "http://www.kduniv.ac.kr/iphak/", boardUrl: "" },
  { id: "u051", name: "경희대(국제)", homeUrl: "http://iphak.khu.ac.kr/web/main/", boardUrl: "https://iphak.khu.ac.kr/web/notice/notice.do" },
  { id: "u052", name: "단국대(죽전)", homeUrl: "http://ipsi.dankook.ac.kr/", boardUrl: "https://ipsi.dankook.ac.kr/notice" },
  { id: "u053", name: "대진대", homeUrl: "http://www.daejin.ac.kr/", boardUrl: "" },
  { id: "u054", name: "동국대(바이오)", homeUrl: "https://ipsi.dongguk.edu/", boardUrl: "https://ipsi.dongguk.edu/article/NOTICE/list" },
  { id: "u055", name: "동양대(동두천)", homeUrl: "http://ipsi.dyu.ac.kr/", boardUrl: "" },
  { id: "u056", name: "루터대", homeUrl: "http://ltu-admission.ac.kr/", boardUrl: "" },
  { id: "u057", name: "명지대(용인)", homeUrl: "http://ipsi.mju.ac.kr/", boardUrl: "https://ipsi.mju.ac.kr/notice" },
  { id: "u058", name: "서울신학대", homeUrl: "http://ipsi.stu.ac.kr/", boardUrl: "" },
  { id: "u059", name: "서울장신대", homeUrl: "http://www.sjs.ac.kr/admission/main/index.php", boardUrl: "" },
  { id: "u060", name: "성결대", homeUrl: "http://ipsi.sungkyul.ac.kr/", boardUrl: "" },
  { id: "u061", name: "수원가톨릭대", homeUrl: "https://www.suwoncatholic.ac.kr/admission/college02.asp", boardUrl: "" },
  { id: "u062", name: "수원대", homeUrl: "http://ipsi.suwon.ac.kr/", boardUrl: "" },
  { id: "u063", name: "신경대/화성의과학대", homeUrl: "https://www.hsmu.ac.kr/admission/main/index.do", boardUrl: "" },
  { id: "u064", name: "신한대(동두천)", homeUrl: "http://ipsi.shinhan.ac.kr/", boardUrl: "" },
  { id: "u065", name: "신한대(의정부)", homeUrl: "http://ipsi.shinhan.ac.kr/", boardUrl: "" },
  { id: "u066", name: "아신대", homeUrl: "https://www.acts.ac.kr/", boardUrl: "" },
  { id: "u067", name: "아주대", homeUrl: "http://www.iajou.ac.kr/", boardUrl: "http://www.iajou.ac.kr/" },
  { id: "u068", name: "안양대(안양)", homeUrl: "http://enter.anyang.ac.kr/", boardUrl: "" },
  { id: "u069", name: "예원예대(양주)", homeUrl: "http://www.yewon.ac.kr/Admission/", boardUrl: "" },
  { id: "u070", name: "용인대", homeUrl: "https://ipsi.yongin.ac.kr/index.do", boardUrl: "" },
  { id: "u071", name: "을지대(성남)", homeUrl: "http://admission.eulji.ac.kr/", boardUrl: "" },
  { id: "u072", name: "을지대(의정부)", homeUrl: "http://admission.eulji.ac.kr/", boardUrl: "" },
  { id: "u073", name: "중부대(고양)", homeUrl: "http://ipsi.joongbu.ac.kr/", boardUrl: "" },
  { id: "u074", name: "중앙대(다빈치)", homeUrl: "http://admission.cau.ac.kr/", boardUrl: "https://admission.cau.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN021" },
  { id: "u075", name: "차의과학대", homeUrl: "http://admission.cha.ac.kr/", boardUrl: "" },
  { id: "u076", name: "칼빈대", homeUrl: "http://www.calvin.ac.kr/main/index.do", boardUrl: "" },
  { id: "u077", name: "평택대", homeUrl: "http://entrance.ptu.ac.kr/", boardUrl: "" },
  { id: "u078", name: "한경국립대", homeUrl: "https://ipsi.hknu.ac.kr/", boardUrl: "" },
  { id: "u079", name: "한국교통대(의왕)", homeUrl: "http://www.ut.ac.kr/ipsi.do", boardUrl: "" },
  { id: "u080", name: "전)산기대 / 한국공학대", homeUrl: "http://iphak.kpu.ac.kr/", boardUrl: "" },
  { id: "u081", name: "한국외대(글로벌)", homeUrl: "http://adms.hufs.ac.kr/", boardUrl: "https://adms.hufs.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN036" },
  { id: "u082", name: "한국항공대", homeUrl: "http://ibhak.kau.ac.kr/", boardUrl: "" },
  { id: "u083", name: "한세대", homeUrl: "http://ipsi.hansei.ac.kr/", boardUrl: "" },
  { id: "u084", name: "한신대", homeUrl: "http://ent.hs.ac.kr/", boardUrl: "" },
  { id: "u085", name: "한양대(에리카)", homeUrl: "http://goerica.hanyang.ac.kr/", boardUrl: "https://goerica.hanyang.ac.kr/new/notice" },
  { id: "u086", name: "협성대", homeUrl: "https://iphak.uhs.ac.kr/intro.jsp", boardUrl: "" },
  { id: "u087", name: "가천대(메디컬)", homeUrl: "http://admission.gachon.ac.kr/admission/html/main/main.asp", boardUrl: "https://admission.gachon.ac.kr/admission/html/counsel/notice.asp" },
  { id: "u088", name: "경인교대(인천)", homeUrl: "http://ipsi.ginue.ac.kr/", boardUrl: "" },
  { id: "u089", name: "안양대(강화)", homeUrl: "http://enter.anyang.ac.kr/", boardUrl: "" },
  { id: "u090", name: "인천가톨릭대(강화)", homeUrl: "https://admission.iccu.ac.kr/default.php", boardUrl: "" },
  { id: "u091", name: "인천가톨릭대(송도)", homeUrl: "https://admission.iccu.ac.kr/default.php", boardUrl: "" },
  { id: "u092", name: "인천대", homeUrl: "http://admission.inu.ac.kr/", boardUrl: "https://admission.inu.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN017" },
  { id: "u093", name: "인하대", homeUrl: "http://admission.inha.ac.kr/", boardUrl: "https://admission.inha.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN031" },
  { id: "u094", name: "청운대(인천)", homeUrl: "http://enter.chungwoon.ac.kr/", boardUrl: "" },
  { id: "u095", name: "가톨릭관동대", homeUrl: "http://ipsi.cku.ac.kr/", boardUrl: "" },
  { id: "u096", name: "강릉원주대(강릉)/강원대", homeUrl: "https://iphak.gwnu.ac.kr/sites/iphak/index.do", boardUrl: "" },
  { id: "u097", name: "강릉원주대(원주)/강원대", homeUrl: "http://ipsi.gwnu.ac.kr/sites/ipsi/index.do", boardUrl: "" },
  { id: "u098", name: "강원대(도계)", homeUrl: "https://www.kangwon.ac.kr/admission01/", boardUrl: "" },
  { id: "u099", name: "강원대(삼척)", homeUrl: "https://www.kangwon.ac.kr/admission01/", boardUrl: "" },
  { id: "u100", name: "강원대(춘천)", homeUrl: "https://www.kangwon.ac.kr/admission01/", boardUrl: "" },
  { id: "u101", name: "경동대(고성)", homeUrl: "http://www.kduniv.ac.kr/iphak/", boardUrl: "" },
  { id: "u102", name: "경동대(원주문막)", homeUrl: "http://www.kduniv.ac.kr/iphak/", boardUrl: "" },
  { id: "u103", name: "상지대", homeUrl: "https://go.sangji.ac.kr/", boardUrl: "" },
  { id: "u104", name: "연세대(미래)", homeUrl: "https://admission.yonsei.ac.kr/mirae/admission/html/main/main.asp", boardUrl: "https://admission.yonsei.ac.kr/mirae/admission/html/notice/notice.asp" },
  { id: "u105", name: "춘천교대", homeUrl: "https://enter.cnue.ac.kr/enter/index.do", boardUrl: "" },
  { id: "u106", name: "한라대", homeUrl: "http://www.halla.ac.kr/mbs/ipsi/", boardUrl: "" },
  { id: "u107", name: "한림대", homeUrl: "http://admission.hallym.ac.kr/", boardUrl: "https://admission.hallym.ac.kr/admission/html/notice/notice.asp" },
  { id: "u108", name: "건양대(대전)", homeUrl: "http://ipsi.konyang.ac.kr/ipsi.do", boardUrl: "" },
  { id: "u109", name: "국군간호사관학교", homeUrl: "https://tapply.tonc.net/kafna/", boardUrl: "" },
  { id: "u110", name: "대전대", homeUrl: "https://ipsi.dju.ac.kr/enter/html/main/main.asp", boardUrl: "" },
  { id: "u111", name: "대전신대", homeUrl: "https://www.daejeon.ac.kr/", boardUrl: "" },
  { id: "u112", name: "목원대", homeUrl: "http://enter.mokwon.ac.kr/", boardUrl: "" },
  { id: "u113", name: "배재대", homeUrl: "http://enter.pcu.ac.kr/", boardUrl: "" },
  { id: "u114", name: "우송대", homeUrl: "http://ent.wsu.ac.kr/", boardUrl: "" },
  { id: "u115", name: "을지대(대전)", homeUrl: "http://admission.eulji.ac.kr/", boardUrl: "" },
  { id: "u116", name: "충남대", homeUrl: "http://ipsi.cnu.ac.kr/", boardUrl: "https://ipsi.cnu.ac.kr/notice" },
  { id: "u117", name: "침례신대", homeUrl: "http://ipsi.kbtus.ac.kr/", boardUrl: "" },
  { id: "u118", name: "한남대", homeUrl: "http://ibsi.hannam.ac.kr/", boardUrl: "" },
  { id: "u119", name: "한밭대", homeUrl: "http://admission.hanbat.ac.kr/", boardUrl: "" },
  { id: "u120", name: "카이스트(KAIST)", homeUrl: "http://admission.kaist.ac.kr/", boardUrl: "https://admission.kaist.ac.kr/notice" },
  { id: "u121", name: "가톨릭꽃동네대", homeUrl: "https://www.kkot.ac.kr/base/main/view", boardUrl: "" },
  { id: "u122", name: "건국대(글로컬)", homeUrl: "http://enter.kku.ac.kr/", boardUrl: "" },
  { id: "u123", name: "공군사관학교", homeUrl: "https://rokaf.airforce.mil.kr/sites/afaadmission/index.do", boardUrl: "https://rokaf.airforce.mil.kr/afaadmission/7161/subview.do" },
  { id: "u124", name: "극동대", homeUrl: "http://ipsi.kdu.ac.kr/", boardUrl: "" },
  { id: "u125", name: "서원대", homeUrl: "http://www.seowon.ac.kr/iphak", boardUrl: "" },
  { id: "u126", name: "세명대", homeUrl: "http://ipsi.semyung.ac.kr/", boardUrl: "" },
  { id: "u127", name: "우석대(진천)", homeUrl: "https://www.woosuk.ac.kr/WoosukEntrance.do", boardUrl: "" },
  { id: "u128", name: "유원대", homeUrl: "https://ipsi.u1.ac.kr/html/ipsi/index.html", boardUrl: "" },
  { id: "u129", name: "중원대", homeUrl: "http://ipsi.jwu.ac.kr/", boardUrl: "" },
  { id: "u130", name: "청주교대", homeUrl: "https://www.cje.ac.kr/ipsi/", boardUrl: "" },
  { id: "u131", name: "청주대", homeUrl: "http://www.cju.ac.kr/ipsi/index.do", boardUrl: "" },
  { id: "u132", name: "충북대", homeUrl: "http://ipsi.chungbuk.ac.kr/", boardUrl: "https://ipsi.chungbuk.ac.kr/notice" },
  { id: "u133", name: "한국교원대", homeUrl: "http://ent.knue.ac.kr/", boardUrl: "" },
  { id: "u134", name: "한국교통대(증평)", homeUrl: "http://www.ut.ac.kr/ipsi.do", boardUrl: "" },
  { id: "u135", name: "한국교통대(충주)", homeUrl: "https://www.ut.ac.kr/ipsi.do", boardUrl: "" },
  { id: "u136", name: "건양대(논산)", homeUrl: "http://ipsi.konyang.ac.kr/ipsi.do", boardUrl: "" },
  { id: "u137", name: "경찰대학교", homeUrl: "https://www.police.ac.kr/police/police/html/ent/dat/req/introduce.do?mdex=police58", boardUrl: "" },
  { id: "u138", name: "고려대(세종)", homeUrl: "https://oku.korea.ac.kr/sejong/index.do", boardUrl: "https://oku.korea.ac.kr/sejong/cms/FR_CON/index.do?MENU_ID=640" },
  { id: "u139", name: "공주교대", homeUrl: "https://www.gjue.ac.kr/gjue/ipsi.do", boardUrl: "" },
  { id: "u140", name: "공주대(공주)", homeUrl: "http://ipsi.kongju.ac.kr/", boardUrl: "" },
  { id: "u141", name: "공주대(예산)", homeUrl: "http://ipsi.kongju.ac.kr/", boardUrl: "" },
  { id: "u142", name: "공주대(천안)", homeUrl: "http://ipsi.kongju.ac.kr/", boardUrl: "" },
  { id: "u143", name: "금강대", homeUrl: "http://www.ggu.ac.kr/matriculation/main.php", boardUrl: "" },
  { id: "u144", name: "나사렛대", homeUrl: "https://cms.kornu.ac.kr/ipsi/index.do", boardUrl: "" },
  { id: "u145", name: "남서울대", homeUrl: "http://www.namseoul.net/", boardUrl: "" },
  { id: "u146", name: "단국대(천안)", homeUrl: "http://ipsi.dankook.ac.kr/", boardUrl: "https://ipsi.dankook.ac.kr/notice" },
  { id: "u147", name: "대전가톨릭대", homeUrl: "https://www.dcatholic.ac.kr/univ/s2/college.php", boardUrl: "" },
  { id: "u148", name: "백석대", homeUrl: "http://ipsi.bu.ac.kr/", boardUrl: "" },
  { id: "u149", name: "상명대(천안)", homeUrl: "http://admission.smu.ac.kr/iphak_home.html", boardUrl: "" },
  { id: "u150", name: "선문대", homeUrl: "http://ilove.sunmoon.ac.kr/", boardUrl: "" },
  { id: "u151", name: "세한대(당진)", homeUrl: "https://apply.sehan.ac.kr/apply/", boardUrl: "" },
  { id: "u152", name: "순천향대", homeUrl: "http://ipsi.sch.ac.kr/", boardUrl: "" },
  { id: "u153", name: "유원대(아산)", homeUrl: "https://ipsi.u1.ac.kr/html/ipsi/index.html", boardUrl: "" },
  { id: "u154", name: "중부대(충청)", homeUrl: "http://ipsi.joongbu.ac.kr/", boardUrl: "" },
  { id: "u155", name: "청운대(홍성)", homeUrl: "http://enter.chungwoon.ac.kr/", boardUrl: "" },
  { id: "u156", name: "한국기술교대", homeUrl: "https://ipsi.koreatech.ac.kr/main.do", boardUrl: "" },
  { id: "u157", name: "한국전통문화대", homeUrl: "https://www.knuh.ac.kr/admission/main.do", boardUrl: "" },
  { id: "u158", name: "한서대", homeUrl: "http://helper.hanseo.ac.kr/", boardUrl: "" },
  { id: "u159", name: "호서대(아산)", homeUrl: "http://ipsi.hoseo.ac.kr/", boardUrl: "" },
  { id: "u160", name: "호서대(천안)", homeUrl: "http://ipsi.hoseo.ac.kr/", boardUrl: "" },
  { id: "u161", name: "홍익대(세종)", homeUrl: "https://www.hongik.ac.kr/kr/admission/undergraduate-admission.do", boardUrl: "https://www.hongik.ac.kr/kr/admission/notice.do" },
  { id: "u162", name: "광신대", homeUrl: "https://www.kwangshin.ac.kr/home/index.do", boardUrl: "" },
  { id: "u163", name: "광주교대", homeUrl: "https://entrance.gnue.ac.kr/index.9is?contentUid=4a9f18ab7591d6de0175920d074900a1", boardUrl: "" },
  { id: "u164", name: "광주대", homeUrl: "http://iphak.gwangju.ac.kr/", boardUrl: "" },
  { id: "u165", name: "광주여대", homeUrl: "http://ipsi.kwu.ac.kr/", boardUrl: "" },
  { id: "u166", name: "남부대", homeUrl: "http://ipsi.nambu.ac.kr/ipsi/", boardUrl: "" },
  { id: "u167", name: "송원대", homeUrl: "http://www.songwon.ac.kr/ipsi/", boardUrl: "" },
  { id: "u168", name: "전남대(광주)", homeUrl: "http://admission.jnu.ac.kr/", boardUrl: "https://admission.jnu.ac.kr/notice" },
  { id: "u169", name: "조선대", homeUrl: "http://ibhak.chosun.ac.kr/", boardUrl: "" },
  { id: "u170", name: "호남대", homeUrl: "http://enter.honam.ac.kr/", boardUrl: "" },
  { id: "u171", name: "호남신대", homeUrl: "http://ipsi.htus.ac.kr/", boardUrl: "" },
  { id: "u172", name: "지스트(GIST)", homeUrl: "http://admission.gist.ac.kr/", boardUrl: "https://admission.gist.ac.kr/notice" },
  { id: "u173", name: "군산대", homeUrl: "http://www.kunsan.ac.kr/iphak/index.kunsan", boardUrl: "" },
  { id: "u174", name: "예수대", homeUrl: "https://www.jesus.ac.kr/enter/inner.php?sMenu=main", boardUrl: "" },
  { id: "u175", name: "예원예대(임실)", homeUrl: "http://www.yewon.ac.kr/Admission/", boardUrl: "" },
  { id: "u176", name: "우석대(전주)", homeUrl: "http://www.woosuk.ac.kr/WoosukEntrance.do", boardUrl: "" },
  { id: "u177", name: "원광대", homeUrl: "http://ipsi.wku.ac.kr/", boardUrl: "" },
  { id: "u178", name: "전북대(익산)", homeUrl: "http://enter.jbnu.ac.kr/main.do", boardUrl: "" },
  { id: "u179", name: "전북대(전주)", homeUrl: "http://enter.jbnu.ac.kr/", boardUrl: "" },
  { id: "u180", name: "전주교대", homeUrl: "https://enter.jnue.kr/index.9is", boardUrl: "" },
  { id: "u181", name: "전주대", homeUrl: "http://iphak.jj.ac.kr/", boardUrl: "" },
  { id: "u182", name: "한일장신대", homeUrl: "http://www.hanil.ac.kr/", boardUrl: "" },
  { id: "u183", name: "호원대", homeUrl: "http://www.howon.ac.kr/2014/_admission/?TM=3", boardUrl: "" },
  { id: "u184", name: "광주가톨릭대", homeUrl: "https://admission.gjc.ac.kr/", boardUrl: "" },
  { id: "u185", name: "동신대", homeUrl: "http://ipsi.dsu.ac.kr/", boardUrl: "" },
  { id: "u186", name: "목포가톨릭대", homeUrl: "http://www.mcu.ac.kr/ipsi/", boardUrl: "" },
  { id: "u187", name: "목포대", homeUrl: "http://ipsi.mokpo.ac.kr/", boardUrl: "" },
  { id: "u188", name: "목포해양대", homeUrl: "https://www.mmu.ac.kr/admission", boardUrl: "" },
  { id: "u189", name: "세한대(영암)", homeUrl: "https://apply.sehan.ac.kr/apply/", boardUrl: "" },
  { id: "u190", name: "순천대", homeUrl: "https://www.scnu.ac.kr/iphak/main.do", boardUrl: "" },
  { id: "u191", name: "영산선학대", homeUrl: "https://youngsan.ac.kr/bbs/board.php?bo_table=2_3", boardUrl: "" },
  { id: "u192", name: "전남대(여수)", homeUrl: "http://admission.jnu.ac.kr/", boardUrl: "https://admission.jnu.ac.kr/notice" },
  { id: "u193", name: "초당대", homeUrl: "http://admission.cdu.ac.kr/", boardUrl: "" },
  { id: "u194", name: "한국에너지공과대학(켄텍)", homeUrl: "https://www.kentech.ac.kr/mainIntro/introhtml.do", boardUrl: "" },
  { id: "u195", name: "경성대", homeUrl: "http://ipsi.ks.ac.kr/", boardUrl: "" },
  { id: "u196", name: "고신대", homeUrl: "https://home.kosin.ac.kr/enter", boardUrl: "" },
  { id: "u197", name: "동명대", homeUrl: "http://iphak.tu.ac.kr/", boardUrl: "" },
  { id: "u198", name: "동서대", homeUrl: "http://uni.dongseo.ac.kr/ipsi/", boardUrl: "" },
  { id: "u199", name: "동아대", homeUrl: "http://ent.donga.ac.kr/", boardUrl: "" },
  { id: "u200", name: "동의대", homeUrl: "http://ipsi.deu.ac.kr/", boardUrl: "" },
  { id: "u201", name: "부경대", homeUrl: "http://iphak.pknu.ac.kr/", boardUrl: "" },
  { id: "u202", name: "부산가톨릭대", homeUrl: "https://ipsi.cup.ac.kr//main/main.asp", boardUrl: "" },
  { id: "u203", name: "부산교대", homeUrl: "https://enter.bnue.ac.kr/Home/Main.mbz", boardUrl: "" },
  { id: "u204", name: "부산대", homeUrl: "http://go.pusan.ac.kr/college_2016/main/main.asp", boardUrl: "https://go.pusan.ac.kr/college_2016/notice/notice_list.asp" },
  { id: "u205", name: "부산외대", homeUrl: "http://enter.bufs.ac.kr/", boardUrl: "" },
  { id: "u206", name: "신라대", homeUrl: "http://ipsi.silla.ac.kr/", boardUrl: "" },
  { id: "u207", name: "영산대(부산)", homeUrl: "http://ipsi.ysu.ac.kr/", boardUrl: "" },
  { id: "u208", name: "국립한국해양대", homeUrl: "http://ipsi.kmou.ac.kr/", boardUrl: "" },
  { id: "u209", name: "경북대(대구)", homeUrl: "http://ipsi1.knu.ac.kr/", boardUrl: "https://ipsi1.knu.ac.kr/notice" },
  { id: "u210", name: "계명대", homeUrl: "http://www.gokmu.ac.kr/", boardUrl: "" },
  { id: "u211", name: "대구교대", homeUrl: "https://admission.dnue.ac.kr/ipsi/Main.do", boardUrl: "" },
  { id: "u212", name: "디지스트(DGIST)", homeUrl: "https://www.dgist.ac.kr/kr/", boardUrl: "" },
  { id: "u213", name: "울산대", homeUrl: "https://www.ulsan.ac.kr/kor/CMS/DeptIntro/intro.do?depart_type=CDE_000089&mCode=MN086", boardUrl: "" },
  { id: "u214", name: "유니스트(UNIST)", homeUrl: "http://adm-u.unist.ac.kr/", boardUrl: "https://adm-u.unist.ac.kr/notice" },
  { id: "u215", name: "경북대(상주)", homeUrl: "http://ipsi1.knu.ac.kr/", boardUrl: "https://ipsi1.knu.ac.kr/notice" },
  { id: "u216", name: "경운대", homeUrl: "http://ipsi.ikw.ac.kr/", boardUrl: "" },
  { id: "u217", name: "경일대", homeUrl: "http://ibsi.kiu.ac.kr/", boardUrl: "" },
  { id: "u218", name: "신경주대", homeUrl: "https://sgu.ac.kr/ko/admission/admission_hub.php", boardUrl: "" },
  { id: "u219", name: "금오공대", homeUrl: "http://iphak.kumoh.ac.kr/", boardUrl: "" },
  { id: "u220", name: "김천대", homeUrl: "http://ibhak.gimcheon.ac.kr/", boardUrl: "" },
  { id: "u221", name: "대구가톨릭대", homeUrl: "http://ibsi.cu.ac.kr/", boardUrl: "" },
  { id: "u222", name: "대구대", homeUrl: "https://ipsi.daegu.ac.kr/html/kr/", boardUrl: "" },
  { id: "u223", name: "대구예대", homeUrl: "https://ipsi.dgau.ac.kr/", boardUrl: "" },
  { id: "u224", name: "대구한의대", homeUrl: "http://ipsi.dhu.ac.kr/", boardUrl: "" },
  { id: "u225", name: "대신대", homeUrl: "http://www.daeshin.ac.kr/html/02_admission/", boardUrl: "" },
  { id: "u226", name: "동국대(와이즈)", homeUrl: "http://ipsi.dongguk.ac.kr/", boardUrl: "" },
  { id: "u227", name: "동양대(양주)", homeUrl: "http://ipsi.dyu.ac.kr/", boardUrl: "" },
  { id: "u228", name: "경국대(구 안동대)", homeUrl: "https://ipsi.gknu.ac.kr/admission/index.htm", boardUrl: "https://ipsi.gknu.ac.kr/admission/index.htm" },
  { id: "u229", name: "영남대", homeUrl: "http://enter.yu.ac.kr/", boardUrl: "https://enter.yu.ac.kr/notice" },
  { id: "u230", name: "영남신대", homeUrl: "http://entra.ytus.ac.kr/", boardUrl: "" },
  { id: "u231", name: "위덕대", homeUrl: "http://ipsi.uu.ac.kr/", boardUrl: "" },
  { id: "u232", name: "육군3사관학교", homeUrl: "https://www.kaay.mil.kr:458/kaay/1142/subview.do", boardUrl: "" },
  { id: "u233", name: "포항공대", homeUrl: "http://adm-u.postech.ac.kr/", boardUrl: "https://adm-u.postech.ac.kr/notice" },
  { id: "u234", name: "한동대", homeUrl: "http://www.handong.edu/ipsi/main/main.jsp", boardUrl: "" },
  { id: "u235", name: "가야대(김해)", homeUrl: "http://ipsi.gimhae.ac.kr/", boardUrl: "" },
  { id: "u236", name: "경남대", homeUrl: "http://ipsi.kyungnam.ac.kr/", boardUrl: "" },
  { id: "u237", name: "경상국립대", homeUrl: "http://new.gnu.ac.kr/", boardUrl: "" },
  { id: "u238", name: "부산장신대", homeUrl: "http://ipsi.bpu.ac.kr/", boardUrl: "" },
  { id: "u239", name: "영산대(양산)", homeUrl: "https://ipsi.ysu.ac.kr/ipsi/intro.do", boardUrl: "" },
  { id: "u240", name: "인제대(김해)", homeUrl: "https://iphak.inje.ac.kr/", boardUrl: "" },
  { id: "u241", name: "진주교대", homeUrl: "http://www.cue.ac.kr/enter/Main.do", boardUrl: "" },
  { id: "u242", name: "창신대", homeUrl: "http://admission.cs.ac.kr/", boardUrl: "" },
  { id: "u243", name: "창원대", homeUrl: "http://ipsi.changwon.ac.kr/", boardUrl: "" },
  { id: "u244", name: "한국국제대", homeUrl: "http://ipsi.iuk.ac.kr/", boardUrl: "" },
  { id: "u245", name: "해군사관학교", homeUrl: "https://www.navy.ac.kr:4443/navyac/index.do", boardUrl: "" },
  { id: "u246", name: "제주국제대", homeUrl: "http://apply.jeju.ac.kr/", boardUrl: "" },
  { id: "u247", name: "제주대", homeUrl: "http://ibsi.jejunu.ac.kr/", boardUrl: "" }
];

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "list";
  try {
    if (action === "ping") {
      return json_({ ok: true, t: Date.now(), sources: UNIV_SOURCES.length });
    }
    if (action === "sources") {
      return json_({
        ok: true,
        sources: UNIV_SOURCES.map(function (s) {
          return {
            id: s.id,
            name: s.name,
            homeUrl: s.homeUrl,
            hasBoard: !!s.boardUrl,
          };
        }),
      });
    }
    if (action === "refresh") {
      var refreshed = refreshNotices();
      return json_(refreshed);
    }
    if (action === "list") {
      return json_(listNoticesPayload_());
    }
    return json_({ ok: false, error: "unknown_action" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** 시간 기반 트리거에서 호출 */
function refreshNotices() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    return listNoticesPayload_();
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var cursor = Number(props.getProperty("REFRESH_CURSOR") || 0);
    if (isNaN(cursor) || cursor < 0) cursor = 0;

    var fetchable = UNIV_SOURCES.filter(function (s) {
      return !!s.boardUrl;
    });
    if (!fetchable.length) {
      return listNoticesPayload_();
    }

    var start = cursor % fetchable.length;
    var batch = [];
    for (var i = 0; i < BATCH_SIZE && i < fetchable.length; i++) {
      batch.push(fetchable[(start + i) % fetchable.length]);
    }
    props.setProperty("REFRESH_CURSOR", String((start + batch.length) % fetchable.length));

    var existing = loadCachedItems_();
    var byKey = {};
    existing.forEach(function (it) {
      byKey[itemKey_(it)] = it;
    });

    var statuses = [];
    batch.forEach(function (src) {
      try {
        var parsed = fetchSourceNotices_(src);
        // 해당 소스 이전 항목 제거 후 교체
        Object.keys(byKey).forEach(function (k) {
          if (byKey[k].univId === src.id) delete byKey[k];
        });
        parsed.forEach(function (it) {
          byKey[itemKey_(it)] = it;
        });
        statuses.push({ id: src.id, name: src.name, ok: true, count: parsed.length });
      } catch (err) {
        statuses.push({
          id: src.id,
          name: src.name,
          ok: false,
          error: String(err && err.message ? err.message : err),
        });
      }
    });

    var merged = Object.keys(byKey).map(function (k) {
      return byKey[k];
    });
    merged = filterAndSort_(merged);
    if (merged.length > MAX_CACHED_ITEMS) merged = merged.slice(0, MAX_CACHED_ITEMS);

    var updatedAt = new Date().toISOString();
    saveCachedItems_(merged, updatedAt);
    saveMeta_({
      updatedAt: updatedAt,
      lastBatch: statuses,
      cursor: Number(props.getProperty("REFRESH_CURSOR") || 0),
      fetchable: fetchable.length,
    });

    return {
      ok: true,
      updatedAt: updatedAt,
      count: merged.length,
      batch: statuses,
      items: merged,
    };
  } finally {
    lock.releaseLock();
  }
}

function listNoticesPayload_() {
  var items = filterAndSort_(loadCachedItems_());
  var meta = loadMeta_();
  return {
    ok: true,
    updatedAt: meta.updatedAt || "",
    count: items.length,
    items: items,
    sourcesTotal: UNIV_SOURCES.length,
    sourcesWithBoard: UNIV_SOURCES.filter(function (s) {
      return !!s.boardUrl;
    }).length,
  };
}

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty("SPREADSHEET_ID");
  var ss = null;
  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (err) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create("kimtaehoon-univ-notices");
    props.setProperty("SPREADSHEET_ID", ss.getId());
  }
  return ss;
}

function getNoticeSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(NOTICE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NOTICE_SHEET);
    sheet.appendRow([
      "id",
      "univId",
      "univName",
      "title",
      "url",
      "homeUrl",
      "dateISO",
      "dateText",
      "fetchedAt",
    ]);
  }
  return sheet;
}

function getMetaSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(META_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(META_SHEET);
    sheet.appendRow(["key", "value"]);
  }
  return sheet;
}

function loadCachedItems_() {
  var sheet = getNoticeSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  return values
    .slice(1)
    .filter(function (r) {
      return r[0] && r[3] && r[4] && r[6];
    })
    .map(function (r) {
      return {
        id: String(r[0]),
        univId: String(r[1]),
        univName: String(r[2]),
        title: String(r[3]),
        url: String(r[4]),
        homeUrl: String(r[5] || ""),
        dateISO: String(r[6]),
        dateText: String(r[7] || r[6]),
        fetchedAt: String(r[8] || ""),
      };
    });
}

function saveCachedItems_(items, updatedAt) {
  var sheet = getNoticeSheet_();
  sheet.clearContents();
  sheet.appendRow([
    "id",
    "univId",
    "univName",
    "title",
    "url",
    "homeUrl",
    "dateISO",
    "dateText",
    "fetchedAt",
  ]);
  if (!items.length) return;
  var rows = items.map(function (it) {
    return [
      it.id,
      it.univId,
      it.univName,
      it.title,
      it.url,
      it.homeUrl || "",
      it.dateISO,
      it.dateText || it.dateISO,
      updatedAt || it.fetchedAt || "",
    ];
  });
  sheet.getRange(2, 1, rows.length, 9).setValues(rows);
}

function loadMeta_() {
  var sheet = getMetaSheet_();
  var values = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < values.length; i++) {
    if (values[i][0]) map[String(values[i][0])] = String(values[i][1] || "");
  }
  var lastBatch = [];
  try {
    if (map.lastBatch) lastBatch = JSON.parse(map.lastBatch);
  } catch (err) {
    lastBatch = [];
  }
  return {
    updatedAt: map.updatedAt || "",
    lastBatch: lastBatch,
    cursor: Number(map.cursor || 0),
    fetchable: Number(map.fetchable || 0),
  };
}

function saveMeta_(meta) {
  var sheet = getMetaSheet_();
  sheet.clearContents();
  sheet.appendRow(["key", "value"]);
  sheet.appendRow(["updatedAt", meta.updatedAt || ""]);
  sheet.appendRow(["cursor", String(meta.cursor || 0)]);
  sheet.appendRow(["fetchable", String(meta.fetchable || 0)]);
  sheet.appendRow(["lastBatch", JSON.stringify(meta.lastBatch || [])]);
}

function itemKey_(it) {
  return String(it.univId || "") + "|" + String(it.url || "") + "|" + String(it.title || "");
}

function filterAndSort_(items) {
  var min = MIN_DATE_ISO;
  return (items || [])
    .filter(function (it) {
      if (!it || !it.title || !it.url || !it.dateISO) return false;
      if (!/^https?:\/\//i.test(it.url)) return false;
      if (it.dateISO < min) return false;
      return true;
    })
    .sort(function (a, b) {
      if (a.dateISO === b.dateISO) {
        return String(b.fetchedAt || "").localeCompare(String(a.fetchedAt || ""));
      }
      return a.dateISO < b.dateISO ? 1 : -1;
    });
}

function fetchSourceNotices_(src) {
  if (!src.boardUrl) return [];
  var html = fetchHtml_(src.boardUrl);
  if (!html) return [];
  var items = parseNoticeHtml_(html, src);
  return filterAndSort_(items).slice(0, MAX_ITEMS_PER_SOURCE);
}

function fetchHtml_(url) {
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: false,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 400) {
    throw new Error("http_" + code);
  }
  var bytes = res.getContent();
  var text = "";
  try {
    text = res.getContentText("UTF-8");
  } catch (err) {
    text = "";
  }
  if (!text || scoreKorean_(text) < 3) {
    try {
      text = res.getContentText("EUC-KR");
    } catch (err2) {
      text = Utilities.newBlob(bytes).getDataAsString("UTF-8");
    }
  }
  return text || "";
}

function scoreKorean_(s) {
  var m = String(s || "").match(/[가-힣]/g);
  return m ? m.length : 0;
}

function parseNoticeHtml_(html, src) {
  var base = src.boardUrl || src.homeUrl;
  var items = [];
  items = items.concat(parseByAnchorDatePattern_(html, src, base));
  items = items.concat(parseYonseiStyle_(html, src, base));
  items = items.concat(parseFrBbsStyle_(html, src, base));
  items = items.concat(parseTableRows_(html, src, base));

  var uniq = {};
  var out = [];
  items.forEach(function (it) {
    if (!it.title || !it.url || !it.dateISO) return;
    if (it.dateISO < MIN_DATE_ISO) return;
    var k = itemKey_(it);
    if (uniq[k]) return;
    uniq[k] = true;
    out.push(it);
  });
  return out;
}

function parseByAnchorDatePattern_(html, src, base) {
  var out = [];
  // <a href="...">title</a> ... 2026.08.01 or 2026-08-01 nearby
  var re =
    /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,240}?)/gi;
  var m;
  while ((m = re.exec(html)) && out.length < MAX_ITEMS_PER_SOURCE * 2) {
    var href = decodeHtml_(m[1]).trim();
    var title = stripTags_(m[2]).replace(/\s+/g, " ").trim();
    var tail = m[3] || "";
    if (!title || title.length < 4 || title.length > 180) continue;
    if (/^(더보기|more|이전|다음|목록|home|로그인)$/i.test(title)) continue;
    if (!isLikelyNoticeHref_(href, title)) continue;

    var dateISO = extractDateISO_(tail) || extractDateISO_(title);
    if (!dateISO) continue;

    var abs = toAbsoluteUrl_(href, base);
    if (!abs) continue;

    out.push(makeItem_(src, title, abs, dateISO));
  }
  return out;
}

function parseYonseiStyle_(html, src, base) {
  var out = [];
  // list blocks often contain notice links + date spans
  var blockRe =
    /<(?:li|tr|div)[^>]*class=["'][^"']*(?:notice|board|list|bbs)[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|tr|div)>/gi;
  var m;
  while ((m = blockRe.exec(html)) && out.length < MAX_ITEMS_PER_SOURCE * 2) {
    var block = m[1];
    var a = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!a) continue;
    var href = decodeHtml_(a[1]).trim();
    var title = stripTags_(a[2]).replace(/\s+/g, " ").trim();
    var dateISO = extractDateISO_(block);
    if (!title || !dateISO) continue;
    if (!isLikelyNoticeHref_(href, title)) continue;
    var abs = toAbsoluteUrl_(href, base);
    if (!abs) continue;
    out.push(makeItem_(src, title, abs, dateISO));
  }
  return out;
}

function parseFrBbsStyle_(html, src, base) {
  var out = [];
  // FR_CON / artclView / board view patterns
  var re =
    /href\s*=\s*["']([^"']*(?:artclView|BoardView|view\.do|noticeView|article\/|bbs\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,300})/gi;
  var m;
  while ((m = re.exec(html)) && out.length < MAX_ITEMS_PER_SOURCE * 2) {
    var href = decodeHtml_(m[1]).trim();
    var title = stripTags_(m[2]).replace(/\s+/g, " ").trim();
    var dateISO = extractDateISO_(m[3] || "") || extractDateISO_(title);
    if (!title || title.length < 4 || !dateISO) continue;
    var abs = toAbsoluteUrl_(href, base);
    if (!abs) continue;
    out.push(makeItem_(src, title, abs, dateISO));
  }
  return out;
}

function parseTableRows_(html, src, base) {
  var out = [];
  var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var m;
  while ((m = rowRe.exec(html)) && out.length < MAX_ITEMS_PER_SOURCE * 2) {
    var row = m[1];
    if (/<th[\s>]/i.test(row)) continue;
    var a = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!a) continue;
    var href = decodeHtml_(a[1]).trim();
    var title = stripTags_(a[2]).replace(/\s+/g, " ").trim();
    var dateISO = extractDateISO_(row);
    if (!title || !dateISO) continue;
    if (!isLikelyNoticeHref_(href, title)) continue;
    var abs = toAbsoluteUrl_(href, base);
    if (!abs) continue;
    out.push(makeItem_(src, title, abs, dateISO));
  }
  return out;
}

function isLikelyNoticeHref_(href, title) {
  if (!href || href === "#" || /^javascript:/i.test(href)) return false;
  if (/logout|login|sitemap|privacy|mailto:/i.test(href)) return false;
  // Prefer notice-like paths, but also accept relative board links with date-confirmed titles
  if (
    /(notice|bbs|board|article|artcl|소식|공지|news|ipsi|admission)/i.test(href) ||
    /(공지|안내|모집|요강|발표|일정|변경)/.test(title)
  ) {
    return true;
  }
  return false;
}

function makeItem_(src, title, url, dateISO) {
  return {
    id: Utilities.base64EncodeWebSafe(src.id + "|" + url).slice(0, 48),
    univId: src.id,
    univName: src.name,
    title: title,
    url: url,
    homeUrl: src.homeUrl,
    dateISO: dateISO,
    dateText: dateISO.replace(/-/g, "."),
    fetchedAt: new Date().toISOString(),
  };
}

function extractDateISO_(text) {
  var s = String(text || "");
  var m =
    s.match(/(20\d{2})[.\-\/년\s]+(\d{1,2})[.\-\/월\s]+(\d{1,2})/) ||
    s.match(/(20\d{2})(\d{2})(\d{2})/);
  if (!m) return "";
  var y = m[1];
  var mo = ("0" + m[2]).slice(-2);
  var d = ("0" + m[3]).slice(-2);
  var iso = y + "-" + mo + "-" + d;
  if (iso < "2020-01-01" || iso > "2035-12-31") return "";
  return iso;
}

function stripTags_(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml_(s) {
  return String(s || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function toAbsoluteUrl_(href, base) {
  href = String(href || "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href.split("#")[0];
  if (/^\/\//.test(href)) return "https:" + href.split("#")[0];
  try {
    var baseMatch = String(base || "").match(/^(https?:\/\/[^\/]+)(\/.*)?$/i);
    if (!baseMatch) return "";
    var origin = baseMatch[1];
    var path = baseMatch[2] || "/";
    if (href.charAt(0) === "/") return origin + href.split("#")[0];
    var dir = path.replace(/\/[^\/]*$/, "/");
    return origin + dir + href.split("#")[0];
  } catch (err) {
    return "";
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
