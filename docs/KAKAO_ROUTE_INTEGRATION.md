# Kakao 지도·자동차 경로 연동

## 키와 호출 경계

- 웹 지도 SDK: `NEXT_PUBLIC_KAKAO_MAP_JAVASCRIPT_KEY`만 브라우저에 포함한다. Kakao Developers의 JavaScript SDK 도메인에 실제 Amplify 도메인과 로컬 개발 도메인을 등록해야 한다.
- 자동차 길찾기: `KAKAO_MOBILITY_REST_API_KEY`는 AWS Secrets Manager `ems-relay/external-api-keys`에만 둔다. 브라우저에서 직접 호출하거나 `NEXT_PUBLIC_*` 변수로 만들지 않는다.
- 운영 경로: 브라우저 → 인증된 `POST /route` → 사건 접근검사 → Lambda → Secrets Manager → Kakao Mobility Directions API 순서로 호출한다. 정밀 좌표는 URL 쿼리가 아니라 JSON 본문(`case_id`, `origin`, `destination`)으로 전송한다.
- 병원 검색: `GET /hospitals`가 NMC 응급의료기관 목록을 기준으로 HIRA 기본정보를 보강하고, 각 기관까지의 Kakao 자동차 거리·ETA를 붙인 뒤 실시간 ETA 순으로 다시 정렬한다. 이 값은 수용 여부가 아니다.

`POST /route` 본문:

```json
{
  "case_id": "GW-CARDIO-051",
  "origin": { "latitude": 38.215416, "longitude": 128.590316 },
  "destination": { "latitude": 38.204543, "longitude": 128.590246 }
}
```

`case_id`는 필수이며 Cognito 사용자가 해당 사건에 접근할 수 있는지 확인한 다음에만 Kakao를 호출한다. API Gateway에는 기본 초당 요청 한도도 적용한다. 정밀 좌표는 URL·접근 로그의 쿼리 문자열에 남기지 않는다.

병원 경로 계약은 `route_source`, `route_is_live`, `is_road_route`를 필수로 반환한다. Kakao 실패 시 `route_source: local_straight_line_estimate`, `route_is_live: false`, `is_road_route: false`, `eta_minutes: null`로 반환하므로 화면은 `직선거리`로 구분하고 ETA를 숨겨야 한다.

기기 GPS는 사용자가 현장 업무에서 위치 사용을 허용한 뒤에만 출발점으로 사용한다. 허용 전에는 사건에 배정된 출동대 또는 신고 현장 좌표를 사용하며, 경로 조회 좌표 자체는 환자 확정 상태나 보고서에 저장하지 않는다.

공식 문서:

- Kakao JavaScript SDK: <https://developers.kakao.com/docs/ko/javascript/getting-started>
- Kakao Mobility 자동차 길찾기: <https://developers.kakaomobility.com/guide/navi-api/directions>

## 속초 시연 위치

| 구분 | 명칭 | 주소 | 좌표 |
|---|---|---|---|
| 출동대 | 영랑119안전센터 | 강원특별자치도 속초시 번영로 188 | 38.2154164233856, 128.59031570815 |
| 현장 | 속초관광수산시장 | 강원특별자치도 속초시 중앙로147번길 16 | 38.204542733975174, 128.5902457350099 |
| 지역 병원 | 강원특별자치도속초의료원 | 강원특별자치도 속초시 영랑호반길 3 | 38.2162289591838, 128.58911853428 |
| 권역 병원 | 강릉아산병원 | 강원특별자치도 강릉시 사천면 방동길 38 | 37.81843791567269, 128.85777946739483 |
| 권역 병원 | 한림대학교춘천성심병원 | 강원특별자치도 춘천시 삭주로 77 | 37.88412960627195, 127.73989083253264 |

영랑119안전센터의 일부 소방본부 요약 페이지에는 이전 주소인 `동해대로 4217`이 남아 있다. 상세 조직 주소표, Kakao 장소 검색, 이전 관련 자료가 일치하는 현 주소 `번영로 188`을 사용한다.

2026-08-04 Kakao Mobility 추천경로 호출로 확인한 저장 시연값:

- 영랑119안전센터 → 속초관광수산시장: 1.9 km / 5분
- 속초관광수산시장 → 속초의료원: 2.2 km / 6분
- 속초관광수산시장 → 강릉아산병원: 60.9 km / 52분
- 속초관광수산시장 → 한림대학교춘천성심병원: 107.1 km / 108분

저장값은 `kakao_mobility_snapshot`, 운영 호출은 `kakao_mobility_live`로 구분한다. 로컬 임의 좌표는 직선거리만 계산하며 `eta_minutes: null`, `local_straight_line_estimate`, `is_road_route: false`로 반환한다.

## 모바일 통합 지점

출동 화면에서는 `SCENARIO.unitBase`를 출발지, `SCENARIO.sceneLocation`을 현장 도착지로 사용한다. 저장 시연값은 `SCENARIO.routeToScene`에 있다. 운영 모드에서는 같은 좌표를 `getRouteReference()`로 보내 실제 거리·ETA와 도로 경로 `path`를 받는다. `SCENARIO.latitude/longitude`는 이후 기기 GPS로 갱신될 수 있으므로 출동 현장 주소와 혼용하지 않는다.

```tsx
<KakaoRouteMap
  origin={SCENARIO.unitBase}
  originName={SCENARIO.unitBase.name}
  destination={SCENARIO.sceneLocation}
  destinationName={SCENARIO.sceneLocation.name}
  path={route.path}
/>
```

병원 단계에서는 현장 또는 현재 GPS 좌표를 출발지, `selectedHospital.latitude/longitude`를 도착지로 사용한다. 도로 `path`가 없을 때 `KakaoRouteMap`은 두 마커만 표시하며 직선을 실제 도로 경로처럼 그리지 않는다.
