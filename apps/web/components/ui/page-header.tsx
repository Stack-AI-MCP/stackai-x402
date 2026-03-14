"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { Navbar, NavbarLeft, NavbarRight } from "@/components/ui/navbar";
import Navigation from "@/components/ui/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";

export function PageHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <Navbar>
          <NavbarLeft>
            <Link href="/" className="flex items-center gap-1.5 sm:gap-2 text-base sm:text-xl font-bold">
              <Image
                src="/images/stacks.png"
                alt="Stacks"
                width={24}
                height={24}
                className="rounded-lg sm:w-8 sm:h-8"
              />
              Stacks<span className="text-primary">AI</span>
            </Link>
            <Navigation />
          </NavbarLeft>
          <NavbarRight>
            <Link
              href="/docs"
              className="hidden text-sm md:block hover:text-primary transition-colors"
            >
              Documentation
            </Link>
            {/* Desktop button */}
            <Button asChild variant="outline" size="sm" className="hidden sm:flex">
              <Link href="/chat">
                Launch Terminal
                <ArrowLeft className="ml-2 h-4 w-4 rotate-180" />
              </Link>
            </Button>
            {/* Mobile button - compact */}
            <Button asChild variant="outline" size="sm" className="sm:hidden px-2.5 text-xs h-8">
              <Link href="/chat">
                Launch
                <ArrowLeft className="ml-1 h-3 w-3 rotate-180" />
              </Link>
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 md:hidden h-8 w-8">
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right">
                <nav className="grid gap-6 text-lg font-medium">
                  <Link href="/" className="flex items-center gap-2 text-xl font-bold">
                    <Image
                      src="/images/stacks.png"
                      alt="Stacks"
                      width={32}
                      height={32}
                      className="rounded-lg"
                    />
                    <span>Stacks<span className="text-primary">AI</span></span>
                  </Link>
                  <Link href="/about" className="text-muted-foreground hover:text-foreground">
                    About
                  </Link>
                  <Link href="/docs" className="text-muted-foreground hover:text-foreground">
                    Documentation
                  </Link>
                  <Link href="/roadmap" className="text-muted-foreground hover:text-foreground">
                    Roadmap
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </NavbarRight>
        </Navbar>
      </div>
    </header>
  );
}