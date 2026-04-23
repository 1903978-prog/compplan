import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass, ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 shadow-sm">
        <CardContent className="pt-8 pb-6 px-8 text-center space-y-5">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Compass className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Page not found</h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              The page you're looking for doesn't exist or has moved.
              Use the navigation above to pick a module, or head back to the dashboard.
            </p>
          </div>
          <div className="flex gap-2 justify-center pt-1">
            <Button variant="outline" onClick={() => window.history.length > 1 ? window.history.back() : null}>
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Go back
            </Button>
            <Link href="/">
              <Button>
                <Home className="w-3.5 h-3.5 mr-1.5" /> Dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
