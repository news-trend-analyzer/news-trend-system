# 📰 News Trend System

> 뉴스 RSS를 수집하고, 실시간 트렌드 키워드를 계산해 제공하는 서비스

---

## 🔗 Links

- **Service URL**: https://trendlab.dev 
- **Blog**: https://velog.io/@hyeok2/series/%EC%8B%A4%EC%8B%9C%EA%B0%84%ED%8A%B8%EB%A0%8C%EB%93%9C%EB%B6%84%EC%84%9D-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8

---

## 👀 Service Preview

실제 서비스 동작 화면 예시입니다.
<p align="center">
  <img src="docs/trendlab-preview3.png" width="32%" />
  <img src="docs/trendlab-preview1.png" width="32%" />
  <img src="docs/trendlab-preview2.png" width="32%" />
</p>

- 실시간 트렌드 키워드 랭킹
- 키워드별 기사 리스트
- 검색어별 기사 리스트

---

## 📌 Introduction

뉴스는 대량으로 생산되지만,  
**지금 실제로 주목받는 이슈가 무엇인지**를 빠르게 파악하기는 어렵습니다.

이 프로젝트는 여러 언론사의 RSS를 기반으로 뉴스를 수집하고,  
기사 본문과 메타데이터를 분석하여 **실시간 트렌드 키워드와 점수**를 계산합니다.

서비스는 역할에 따라 다음과 같이 분리되어 있습니다.

- **Collector 서비스**
  - RSS 수집 및 본문 스크래핑
  - 기사 데이터 Elasticsearch 인덱싱
- **Trend 서비스**
  - 큐로 전달된 기사 데이터를 기반으로 트렌드 점수 계산
  - Redis 기반 실시간 트렌드 랭킹 제공

---
## 🔄 Service Flow

뉴스 수집부터 트렌드 점수 계산까지의 전체 데이터 흐름입니다.

<p align="center">
  <img src="docs/trendlab-service.png" width="80%" />
</p>


## 🏗 System Architecture

AWS EC2 환경에서 Docker Compose 기반으로 배포된 시스템 구성입니다.

<p align="center">
  <img src="docs/trendlab-architecture.png" width="90%" />
</p>

---

## 🧠 Design Decisions

### Redis 기반 트렌드 랭킹
- 실시간 랭킹 조회 시 DB 반복 접근으로 인한 병목 방지
- ZSET을 활용한 점수 기반 정렬 및 빠른 조회 구현

### Queue 기반 비동기 처리
- 뉴스 수집과 트렌드 계산 로직 분리
- 수집 트래픽 증가 시에도 트렌드 계산 서비스 안정성 유지

### Elasticsearch 도입
- 원본 기사 데이터 검색 및 분석 전용
- 트렌드 계산 로직과 조회 API의 책임 분리

---

## 🛠 Tech Stack

- **Language**: TypeScript
- **Runtime / Framework**: Node.js, NestJS
- **Cache / Queue**: Redis, BullMQ
- **Search / Analytics**: Elasticsearch, Kibana
- **Infra**: Docker, Docker Compose, AWS EC2

—
