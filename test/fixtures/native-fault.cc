#include <node.h>
#include <cstdint>
#include <memory>

// Reproduce a synchronous fault on a real V8 platform worker without app data.
class FaultTask final : public v8::Task {
 public:
  void Run() override {
    volatile std::uintptr_t bad_address = 0xb;
    const volatile auto* pointer =
        reinterpret_cast<const volatile unsigned char*>(bad_address);
    (void)*pointer;
  }
};

void Schedule(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* env = node::GetCurrentEnvironment(args.GetIsolate()->GetCurrentContext());
  node::GetMultiIsolatePlatform(env)->PostTaskOnWorkerThread(
      v8::TaskPriority::kUserVisible, std::make_unique<FaultTask>());
}

NODE_MODULE_INIT() {
  NODE_SET_METHOD(exports, "schedule", Schedule);
}
