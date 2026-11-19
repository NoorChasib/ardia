cmake_minimum_required(VERSION 3.22.1)
project(nillahermes CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(hermes-engine REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)

add_library(nillahermes SHARED ${ARDIA_SCRIPT_SHIM} src/main/cpp/nilla_js_profiler.cpp)
if(NOT ARDIA_SCRIPT_LOGS)
  target_compile_definitions(nillahermes PRIVATE ARDIA_SCRIPT_QUIET)
endif()
target_compile_options(nillahermes PRIVATE -fexceptions -frtti -Wall -Werror)
target_link_libraries(nillahermes hermes-engine::hermesvm ReactAndroid::jsi fbjni::fbjni log)
